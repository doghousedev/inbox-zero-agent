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
  type GmailListItem = { id: string; threadId?: string; subject: string; from: string; date: string; snippet: string; bodyText?: string; unsubscribeUrl?: string };
  let signedInEmail: string | null = null;
  let gmailItems: Array<GmailListItem>|null = null;
  let gmailError: string | null = null;
  let categoryFilter: 'All' | 'Important' | 'Low Priority' | 'Promotional' | 'Spam' | 'Subscription' = 'All';
  let groupBy: 'none' | 'subject' | 'thread' | 'sender' = 'none';
  // Holds groups for current derived view: repId -> items in group
  let currentGroupMap: Record<string, GmailListItem[]> = {};

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
        threadId: m.threadId,
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
    // restore groupBy preference
    try {
      const gb = localStorage.getItem('groupBy');
      if (gb === 'none' || gb === 'subject' || gb === 'thread' || gb === 'sender') groupBy = gb as any;
    } catch {}
    await fetchProfile();
    await fetchMessages();
  });

  $: (() => {
    try { localStorage.setItem('groupBy', groupBy); } catch {}
  })();

  // Normalize subjects to group similar threads ignoring reply/forward prefixes
  function normalizeSubject(subj: string): string {
    if (!subj) return '';
    let s = subj.trim();
    const prefix = /^(re|fw|fwd|sv|aw|antwort|rv|res|tr):\s*/i;
    while (prefix.test(s)) s = s.replace(prefix, '');
    return s.replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function normalizeSender(from: string): string {
    if (!from) return '';
    // try to extract email inside <...>
    const m = from.match(/<([^>]+)>/);
    const email = (m ? m[1] : from).trim().toLowerCase();
    // prefer domain grouping to cluster newsletters from same domain
    const at = email.lastIndexOf('@');
    return at !== -1 ? email.slice(at + 1) : email;
  }

  // Derived view: optionally group, filter by category, then sort by score desc
  const groupCounts: Record<string, number> = {};
  function parseDate(d: string): number { const t = Date.parse(d); return isNaN(t) ? 0 : t; }
  function deriveItems(): GmailListItem[] {
    if (!gmailItems) return [];
    let items = gmailItems.slice();

    if (groupBy !== 'none') {
      const map = new Map<string, GmailListItem[]>();
      for (const m of items) {
        let key: string;
        if (groupBy === 'thread') key = m.threadId || normalizeSubject(m.subject);
        else if (groupBy === 'subject') key = normalizeSubject(m.subject);
        else /* sender */ key = normalizeSender(m.from);
        const arr = map.get(key) || [];
        arr.push(m);
        map.set(key, arr);
      }
      const reps: GmailListItem[] = [];
      // reset counts
      for (const k in groupCounts) delete groupCounts[k];
      currentGroupMap = {};
      for (const [, arr] of map) {
        // choose representative by highest score if exists, else first
        let rep = arr[0];
        let best = results[rep.id]?.score ?? 0;
        for (const m of arr) {
          const sc = results[m.id]?.score ?? 0;
          if (sc > best) {
            best = sc;
            rep = m;
          }
        }
        reps.push(rep);
        groupCounts[rep.id] = arr.length;
        currentGroupMap[rep.id] = arr;
      }
      // Sort groups by latest message date in each group (desc), Gmail-like
      items = reps.sort((a, b) => {
        const ga = currentGroupMap[a.id] || [a];
        const gb = currentGroupMap[b.id] || [b];
        const la = ga.reduce((mx, m) => Math.max(mx, parseDate(m.date)), 0);
        const lb = gb.reduce((mx, m) => Math.max(mx, parseDate(m.date)), 0);
        return lb - la;
      });
    }
    if (categoryFilter !== 'All') {
      items = items.filter((it) => results[it.id]?.category === categoryFilter);
    }
    // When grouped, keep date sort above. When not grouped, sort by score desc as before.
    if (groupBy === 'none') {
      return items.sort((a, b) => (results[b.id]?.score ?? 0) - (results[a.id]?.score ?? 0));
    }
    return items;
  }
  // Compute once per tick to keep currentGroupMap/groupCounts consistent during render
  let derivedItems: GmailListItem[] = [];
  // Make dependencies explicit so Svelte surely tracks them
  $: {
    // Short-circuit: if no grouping and filter is All, just show gmailItems
    if (gmailItems && groupBy === 'none' && categoryFilter === 'All') {
      derivedItems = gmailItems.slice();
    } else {
      derivedItems = deriveItems();
    }
  }

  function groupParticipants(repId: string): string {
    const arr = currentGroupMap[repId] || [];
    const names = new Set<string>();
    for (const m of arr) {
      const from = m.from || '';
      const name = from.split('<')[0].trim() || from;
      if (name) names.add(name.replace(/"/g, ''));
    }
    return Array.from(names).slice(0, 3).join(', ') + (names.size > 3 ? '…' : '');
  }

  function latestInGroup(repId: string): GmailListItem | null {
    const arr = currentGroupMap[repId] || [];
    if (arr.length === 0) return null;
    return arr.reduce((best, m) => (parseDate(m.date) > parseDate(best.date) ? m : best), arr[0]);
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

<main class="p-8 mx-0 w-full">
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
      <label class="text-sm text-neutral-300">Filter:</label>
      <select
        class="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
        bind:value={categoryFilter}
        disabled={loading}
        aria-label="Filter messages"
      >
        <option value="All">All</option>
        <option value="Important">Important</option>
        <option value="Low Priority">Low Priority</option>
        <option value="Promotional">Promotional</option>
        <option value="Spam">Spam</option>
        <option value="Subscription">Subscription</option>
      </select>
    </div>
    <div class="flex items-center gap-2">
      <label class="text-sm text-neutral-300">Group by:</label>
      <select
        class="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
        bind:value={groupBy}
        disabled={loading}
        aria-label="Group messages"
      >
        <option value="none">None</option>
        <option value="subject">Subject</option>
        <option value="thread">Thread</option>
        <option value="sender">Sender</option>
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
      <p class="text-xs text-neutral-500">Loaded: {gmailItems.length} • Showing: {derivedItems.length} • Filter: {categoryFilter} • Group: {groupBy}</p>
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
        <!-- Summary of grouping when active -->
        {#if groupBy !== 'none'}
          <p class="text-xs text-neutral-400 mb-1">Grouped {gmailItems.length} messages into {Object.keys(currentGroupMap).length || derivedItems.length} groups (by {groupBy}).</p>
        {/if}
        <ul class="space-y-2">
          {#each derivedItems as m, i}
            <li class="p-3 rounded-md border border-neutral-700">
              <!-- Header row: Gmail-like conversation summary -->
              <div
                class="flex items-center gap-2 cursor-pointer rounded-md px-1"
                class:bg-neutral-800={(groupBy !== 'none' && groupCounts[m.id] > 1 && !(collapsed[m.id + '_thread'] ?? true)) || (groupBy === 'none' && !collapsed[m.id])}
                class:border={(groupBy !== 'none' && groupCounts[m.id] > 1 && !(collapsed[m.id + '_thread'] ?? true)) || (groupBy === 'none' && !collapsed[m.id])}
                class:border-sky-700={(groupBy !== 'none' && groupCounts[m.id] > 1 && !(collapsed[m.id + '_thread'] ?? true)) || (groupBy === 'none' && !collapsed[m.id])}
                on:click={() => {
                  if (groupBy !== 'none' && groupCounts[m.id] > 1) {
                    collapsed[m.id + '_thread'] = !(collapsed[m.id + '_thread'] ?? true);
                  } else {
                    collapsed[m.id] = !collapsed[m.id];
                  }
                }}
                aria-expanded={((groupBy !== 'none' && groupCounts[m.id] > 1 && !(collapsed[m.id + '_thread'] ?? true)) || (groupBy === 'none' && !collapsed[m.id])) ? 'true' : 'false'}
                title={'Toggle ' + ((groupBy !== 'none' && groupCounts[m.id] > 1) ? 'thread' : 'message')}
              >
                <svg class="h-4 w-4 text-neutral-300 transition-transform"
                    class:rotate-90={(groupBy !== 'none' && groupCounts[m.id] > 1) ? !(collapsed[m.id + '_thread'] ?? true) : !collapsed[m.id]}
                    xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 0 1-1.06-1.06L10.06 9.8 6.15 5.89a.75.75 0 1 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5Z" clip-rule="evenodd" />
                </svg>
                <div class="flex-1 min-w-48">
                  <div class="font-semibold">{m.subject}</div>
                  {#if groupBy !== 'none' && groupCounts[m.id] > 1}
                    <div class="text-xs text-neutral-400 truncate">
                      {groupParticipants(m.id)} — {latestInGroup(m.id)?.snippet}
                    </div>
                  {:else}
                    <div class="text-xs text-neutral-400 truncate">{m.snippet}</div>
                  {/if}
                </div>
                {#if groupBy !== 'none' && groupCounts[m.id] > 1}
                  <span class="text-xs rounded px-2 py-1 border border-neutral-600 text-neutral-300">x{groupCounts[m.id]}</span>
                  {#if !(collapsed[m.id + '_thread'] ?? true)}
                    <span class="text-[10px] rounded px-1.5 py-0.5 border border-sky-700 text-sky-300">Open</span>
                  {/if}
                {/if}
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
                <span class="text-xs text-neutral-400 ml-2">{(latestInGroup(m.id)?.date) || m.date}</span>
              </div>

              <!-- Expanded thread content when grouped -->
              {#if groupBy !== 'none' && groupCounts[m.id] > 1}
                {#if !(collapsed[m.id + '_thread'] ?? true)}
                  <ul class="mt-2 space-y-2">
                    {#each (currentGroupMap[m.id] || []) as cm}
                      <li class="p-2 border border-neutral-800 rounded">
                        <div class="flex items-center gap-2">
                          <div class="flex-1 min-w-48">
                            <div class="text-sm text-neutral-300 truncate">{cm.from}</div>
                            <div class="text-xs text-neutral-400 truncate">{cm.subject}</div>
                            <div class="text-xs text-neutral-500">{cm.date}</div>
                          </div>
                          <span class="text-xs rounded px-2 py-0.5 border border-neutral-600 text-neutral-300">{results[cm.id]?.score ?? 0}</span>
                          <select
                            class="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs"
                            bind:value={tones[cm.id]}
                            aria-label="Tone"
                          >
                            <option value="Professional">Professional</option>
                            <option value="Friendly">Friendly</option>
                            <option value="Brief">Brief</option>
                            <option value="Empathetic">Empathetic</option>
                          </select>
                          <button
                            class="bg-neutral-800 text-white border border-neutral-600 px-2 py-1 rounded text-xs hover:enabled:bg-neutral-700"
                            on:click={() => regenerateGmail(cm)}
                            disabled={regenerating[cm.id] || loading}
                          >Triage</button>
                          <button
                            class="bg-neutral-800 text-white border border-neutral-600 px-2 py-1 rounded text-xs hover:enabled:bg-neutral-700"
                            on:click={() => (collapsed[cm.id] = !collapsed[cm.id])}
                          >{collapsed[cm.id] ? 'Expand' : 'Collapse'}</button>
                        </div>
                        {#if cm.unsubscribeUrl}
                          <div class="mt-2">
                            <a class="inline-block bg-red-700 hover:bg-red-600 text-white text-xs px-2 py-1 rounded" href={cm.unsubscribeUrl} target="_blank" rel="noopener noreferrer">Unsubscribe</a>
                          </div>
                        {/if}
                        {#if !collapsed[cm.id]}
                          <div class="mt-2 space-y-1">
                            <p class="flex items-center gap-2 text-sm">
                              <strong>Summary:</strong>
                              <span>{results[cm.id]?.summary ?? ''}</span>
                              {#if results[cm.id]?.summary === 'Thinking...'}
                                <svg class="animate-spin h-4 w-4 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                  <path class="opacity-75" fill="currentColor" d="M4 12a 8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                                </svg>
                              {/if}
                            </p>
                            {#if i < 3}
                              <p class="font-semibold text-sm">✍️ Draft:</p>
                              <pre class="bg-neutral-800 p-2 rounded-md whitespace-pre-wrap overflow-x-auto text-xs">{results[cm.id]?.draft ?? ''}</pre>
                            {/if}
                          </div>
                        {/if}
                      </li>
                    {/each}
                  </ul>
        {#if gmailItems.length > 0 && derivedItems.length === 0}
          <div class="mt-2">
            <p class="text-xs text-amber-400">Showing fallback list (filter/group yielded 0). This will be hidden once the pipeline yields items.</p>
            <ul class="mt-1 space-y-1">
              {#each gmailItems as gm}
                <li class="text-sm text-neutral-300">{gm.subject} <span class="text-xs text-neutral-500">— {gm.from}</span></li>
              {/each}
            </ul>
          </div>
        {/if}
                {/if}
              {:else}
                <!-- Single-message (not grouped) expanded content -->
                <div class="text-sm text-neutral-300">From: {m.from}</div>
                <div class="text-xs text-neutral-400">{m.date}</div>
                <div class="text-sm text-neutral-400 mt-1">{m.snippet}</div>
                {#if m.unsubscribeUrl}
                  <div class="mt-2">
                    <a class="inline-block bg-red-700 hover:bg-red-600 text-white text-xs px-2 py-1 rounded" href={m.unsubscribeUrl} target="_blank" rel="noopener noreferrer">Unsubscribe</a>
                  </div>
                {/if}
                <div class="mt-2 flex items-center gap-2">
                  <select
                    class="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
                    bind:value={tones[m.id]}
                    aria-label="Tone"
                  >
                    <option value="Professional">Professional</option>
                    <option value="Friendly">Friendly</option>
                    <option value="Brief">Brief</option>
                    <option value="Empathetic">Empathetic</option>
                  </select>
                  <button
                    class="bg-neutral-800 text-white border border-neutral-600 px-2 py-1 rounded text-sm hover:enabled:bg-neutral-700"
                    on:click={() => regenerateGmail(m)}
                    disabled={regenerating[m.id] || loading}
                  >Triage</button>
                </div>
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


