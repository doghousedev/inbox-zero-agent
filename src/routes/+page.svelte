<script lang="ts">
  import { onMount } from 'svelte';
  import { generateEmailDraft, TRIAGE_MODELS } from '$lib/gpt';

  type EmailDraft = {
    summary: string;
    score: number;
    category: 'Important' | 'Low Priority' | 'Promotional' | 'Spam' | 'Subscription';
    draft: string;
  };

  type Tone = 'Professional' | 'Friendly' | 'Brief' | 'Empathetic';

  let results: Record<string, EmailDraft> = {};
  let tones: Record<string, Tone> = {};
  let defaultTone: Tone = 'Professional';
  let loading = false;
  let regenerating: Record<string, boolean> = {};
  let collapsed: Record<string, boolean> = {};
  // Using real Gmail items only
  let selectedModel: string = (import.meta.env.VITE_OPENAI_MODEL as string) || 'gpt-5-nano';

  // Auth/session data from server
  type GmailListItem = { id: string; subject: string; from: string; date: string; snippet: string; bodyText?: string; unsubscribeUrl?: string };
  let signedInEmail: string | null = null;
  let gmailItems: Array<GmailListItem>|null = null;
  let gmailError: string | null = null;
  let categoryFilter: 'All' | 'Important' | 'Low Priority' | 'Promotional' | 'Spam' | 'Subscription' = 'All';

  async function fetchProfile() {
    try {
      const res = await fetch('/api/gmail/profile');
      if (!res.ok) return;
      const data = await res.json();
      signedInEmail = data.emailAddress || null;
    } catch {}
  }

  async function regenerateGmail(item: GmailListItem) {
    const id = item.id;
    regenerating[id] = true;
    const selectedTone: Tone = tones[id] ?? defaultTone;
    try {
      results[id] = { summary: 'Thinking...', score: 0, category: 'Low Priority', draft: '' };
      const parsed = await generateEmailDraft(
        { subject: item.subject, body: item.bodyText || item.snippet },
        selectedTone,
        selectedModel
      );
      results[id] = parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results[id] = { summary: '[Error] Failed to generate', score: 0, category: 'Low Priority', draft: message };
    }
    regenerating[id] = false;
  }

  async function runTriageGmail() {
    if (!gmailItems || gmailItems.length === 0) return;
    loading = true;
    results = {};
    for (const item of gmailItems) {
      results[item.id] = { summary: 'Thinking...', score: 0, category: 'Low Priority', draft: '' };
      const selectedTone: Tone = tones[item.id] ?? defaultTone;
      try {
        const parsed = await generateEmailDraft(
          { subject: item.subject, body: (item as any).bodyText || item.snippet },
          selectedTone,
          selectedModel
        );
        results[item.id] = parsed;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[item.id] = { summary: '[Error] Failed to generate', score: 0, category: 'Low Priority', draft: message };
      }
    }
    // Auto-clean after triage
    try { await smartCleanInbox(gmailItems); } catch {}
    loading = false;
  }

  async function fetchMessages() {
    try {
      const res = await fetch('/api/gmail/messages');
      if (!res.ok) {
        gmailError = `Messages request failed (${res.status})`;
        return;
      }
      const data = await res.json();
      gmailItems = (data.items || []).map((m: any) => ({
        id: m.id,
        subject: m.subject || '',
        from: m.from || '',
        date: m.date || '',
        snippet: m.snippet || '',
        bodyText: m.bodyText || '',
        unsubscribeUrl: m.unsubscribeUrl || undefined
      }));
      // Initialize collapsed defaults for Gmail items (tone falls back to defaultTone)
      for (const m of gmailItems) {
        if (collapsed[m.id] === undefined) collapsed[m.id] = true;
      }
    } catch (e) {
      gmailError = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(async () => {
    await fetchProfile();
    await fetchMessages();
  });

  // Derived view: filter by category (if results exist), then sort by score desc
  function deriveItems(): GmailListItem[] {
    if (!gmailItems) return [];
    let items = gmailItems.slice();
    if (categoryFilter !== 'All') {
      items = items.filter((it) => results[it.id]?.category === categoryFilter);
    }
    return items.sort((a, b) => (results[b.id]?.score ?? 0) - (results[a.id]?.score ?? 0));
  }

  async function smartCleanInbox(emails: GmailListItem[]) {
    const toTrash = emails.filter((e) => {
      const r = results[e.id];
      if (!r) return false;
      const isJunk = r.category === 'Spam' || r.category === 'Promotional';
      return isJunk && (r.score ?? 0) < 3;
    });
    for (const e of toTrash) {
      try {
        await fetch('/api/gmail/modify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: e.id, removeLabelIds: ['INBOX'], addLabelIds: ['TRASH'] })
        });
      } catch {}
    }
  }
</script>

<main class="p-8 max-w-4xl mx-auto">
  <h1 class="text-2xl mb-4 text-sky-300">📬 Inbox Zero Agent</h1>

  <div class="flex items-center gap-4 flex-wrap">
    <a
      href="/auth/login"
      class="bg-blue-600 text-white border border-blue-500 px-4 py-2 rounded-md font-bold hover:bg-blue-500"
      aria-label="Login with Google"
    >
      Login with Google
    </a>
    {#if signedInEmail}
      <span class="text-sm text-neutral-300">Signed in as <strong>{signedInEmail}</strong></span>
      <a
        href="/auth/logout"
        class="bg-red-600 text-white border border-red-500 px-3 py-2 rounded-md font-semibold hover:bg-red-500"
        aria-label="Logout"
      >Logout</a>
    {/if}
    <button
      class="bg-neutral-800 text-white border border-neutral-600 px-4 py-2 rounded-md font-bold disabled:opacity-50 disabled:cursor-wait hover:enabled:bg-neutral-700"
      on:click={runTriageGmail}
      disabled={loading || !gmailItems || gmailItems.length === 0}
    >
      {loading ? 'Working...' : 'Triage My Inbox'}
    </button>
    <div class="flex items-center gap-2">
      <label class="text-sm text-neutral-300">Model:</label>
      <select
        class="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
        bind:value={selectedModel}
        disabled={loading}
      >
        {#each TRIAGE_MODELS as m}
          <option value={m.id}>{m.label}</option>
        {/each}
      </select>
    </div>
    <div class="flex items-center gap-2">
      <label class="text-sm text-neutral-300">Default Tone:</label>
      <select
        class="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
        bind:value={defaultTone}
        disabled={loading}
        aria-label="Default tone for triage"
      >
        <option value="Professional">Professional</option>
        <option value="Friendly">Friendly</option>
        <option value="Brief">Brief</option>
        <option value="Empathetic">Empathetic</option>
      </select>
    </div>

  {#if gmailItems}
    <section class="mt-6">
      <h2 class="text-xl mb-2">Latest Gmail (25)</h2>
      {#if gmailItems.length === 0}
        <p class="text-neutral-400">No messages.</p>
      {:else}
        <div class="mb-3">
          <button
            class="bg-neutral-800 text-white border border-neutral-600 px-3 py-1 rounded text-sm hover:enabled:bg-neutral-700 disabled:opacity-50"
            on:click={runTriageGmail}
            disabled={loading}
          >{loading ? 'Working...' : 'Triage All (Gmail)'}</button>
        </div>
        <ul class="space-y-2">
          {#each deriveItems() as m, i}
            <li class="p-3 rounded-md border border-neutral-700">
              <div class="flex flex-wrap items-center gap-2">
                <div class="font-semibold flex-1 min-w-48">{m.subject}</div>
                {#if results[m.id]?.category}
                  <span class="text-xs rounded px-2 py-1 text-white"
                    class:bg-emerald-600={results[m.id]?.category === 'Important'}
                    class:bg-slate-600={results[m.id]?.category === 'Low Priority'}
                    class:bg-indigo-600={results[m.id]?.category === 'Promotional'}
                    class:bg-rose-600={results[m.id]?.category === 'Spam'}
                    class:bg-amber-600={results[m.id]?.category === 'Subscription'}
                  >{results[m.id]?.category}</span>
                {/if}
                <span class="text-xs rounded px-2 py-1 border border-neutral-600 text-neutral-300">Score: {results[m.id]?.score ?? 0}</span>
                <div class="flex items-center gap-2">
                  <label class="text-sm text-neutral-300">Tone:</label>
                  <select
                    class="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
                    value={tones[m.id] ?? defaultTone}
                    on:change={(e) => { tones[m.id] = (e.target as HTMLSelectElement).value as Tone; regenerateGmail(m); }}
                    disabled={regenerating[m.id] || loading}
                  >
                    <option value="Professional">Professional</option>
                    <option value="Friendly">Friendly</option>
                    <option value="Brief">Brief</option>
                    <option value="Empathetic">Empathetic</option>
                  </select>
                </div>
                <button
                  class="bg-neutral-800 text-white border border-neutral-600 px-2 py-1 rounded text-sm hover:enabled:bg-neutral-700"
                  on:click={() => regenerateGmail(m)}
                  disabled={regenerating[m.id] || loading}
                  aria-label="Triage this email"
                >Triage</button>
                <button
                  class="ml-auto bg-neutral-800 text-white border border-neutral-600 px-2 py-1 rounded text-sm hover:enabled:bg-neutral-700"
                  on:click={() => (collapsed[m.id] = !collapsed[m.id])}
                >{collapsed[m.id] ? 'Expand' : 'Collapse'}</button>
                {#if regenerating[m.id]}
                  <span class="text-xs text-neutral-400">Regenerating…</span>
                {/if}
              </div>

              <div class="text-sm text-neutral-300">From: {m.from}</div>
              <div class="text-xs text-neutral-400">{m.date}</div>
              <div class="text-sm text-neutral-400 mt-1">{m.snippet}</div>
              {#if m.unsubscribeUrl}
                <div class="mt-2">
                  <a class="inline-block bg-red-700 hover:bg-red-600 text-white text-xs px-2 py-1 rounded" href={m.unsubscribeUrl} target="_blank" rel="noopener noreferrer">Unsubscribe</a>
                </div>
              {/if}

              {#if !collapsed[m.id]}
                <div class="mt-3 space-y-2">
                  <p class="flex items-center gap-2">
                    <strong>Summary:</strong>
                    <span>{results[m.id]?.summary ?? ''}</span>
                    {#if results[m.id]?.summary === 'Thinking...'}
                      <svg class="animate-spin h-4 w-4 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                      </svg>
                    {/if}
                  </p>
                  {#if i < 3}
                    <p class="font-semibold">✍️ Draft:</p>
                    <pre class="bg-neutral-800 p-3 rounded-md whitespace-pre-wrap overflow-x-auto">{results[m.id]?.draft ?? ''}</pre>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else if gmailError}
    <p class="text-red-400 mt-4">{gmailError}</p>
  {/if}
  </div>

  
</main>


