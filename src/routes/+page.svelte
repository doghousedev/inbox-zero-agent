<script lang="ts">
  import { mockEmails } from '$lib/mockEmails';
  import { generateEmailDraft, TRIAGE_MODELS } from '$lib/gpt';

  type EmailDraft = {
    summary: string;
    score: number;
    draft: string;
  };

  type Tone = 'Professional' | 'Friendly' | 'Brief' | 'Empathetic';

  let results: Record<string, EmailDraft> = {};
  let tones: Record<string, Tone> = {};
  let loading = false;
  let regenerating: Record<string, boolean> = {};
  let collapsed: Record<string, boolean> = {};
  let orderedEmails = [...mockEmails];
  let selectedModel: string = (import.meta.env.VITE_OPENAI_MODEL as string) || 'gpt-5-nano';

  // Initialize default tones to 'Professional'
  if (Object.keys(tones).length === 0) {
    for (const e of mockEmails) tones[e.id] = 'Professional';
  }
  // Initialize all cards as collapsed by default
  if (Object.keys(collapsed).length === 0) {
    for (const e of mockEmails) collapsed[e.id] = true;
  }

  async function runTriage() {
    loading = true;
    results = {};
    // Lock order during triage to current order (typically initial order)
    orderedEmails = [...mockEmails];

    for (const email of mockEmails) {
      results[email.id] = {
        summary: 'Thinking...',
        score: 0,
        draft: ''
      };

      const selectedTone: Tone = tones[email.id] ?? 'Professional';
      try {
        const parsed = await generateEmailDraft(email, selectedTone, selectedModel);
        results[email.id] = parsed;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[email.id] = {
          summary: '[Error] Failed to generate',
          score: 0,
          draft: message
        };
      }
    }

    loading = false;
  }

  async function regenerate(email: { id: string; subject: string; body: string }) {
    const id = email.id;
    regenerating[id] = true;
    const selectedTone: Tone = tones[id] ?? 'Professional';
    try {
      results[id] = { summary: 'Thinking...', score: 0, draft: '' };
      const parsed = await generateEmailDraft(email, selectedTone, selectedModel);
      results[id] = parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results[id] = { summary: '[Error] Failed to generate', score: 0, draft: message };
    }
    regenerating[id] = false;
  }
</script>

<main class="p-8 max-w-4xl mx-auto">
  <h1 class="text-2xl mb-4 text-sky-300">📬 Inbox Zero Agent</h1>

  <div class="flex items-center gap-4 flex-wrap">
    <button
      class="bg-neutral-800 text-white border border-neutral-600 px-4 py-2 rounded-md font-bold disabled:opacity-50 disabled:cursor-wait hover:enabled:bg-neutral-700"
      on:click={runTriage}
      disabled={loading}
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
  </div>

  {#each orderedEmails as email, i}
    <div
      class="mt-4 p-4 rounded-lg border-2"
      class:border-green-500={i < 3}
      class:border-neutral-400={i >= 3}
    >
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-lg font-semibold flex-1 min-w-48">{email.subject}</h2>
        <span class="text-xs rounded px-2 py-1 border border-neutral-600 text-neutral-300">Score: {results[email.id]?.score ?? 0}</span>
        <div class="flex items-center gap-2">
          <label class="text-sm text-neutral-300">Tone:</label>
          <select
            class="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-sm"
            bind:value={tones[email.id]}
            on:change={() => regenerate(email)}
            disabled={regenerating[email.id] || loading}
          >
            <option value="Professional">Professional</option>
            <option value="Friendly">Friendly</option>
            <option value="Brief">Brief</option>
            <option value="Empathetic">Empathetic</option>
          </select>
        </div>
        <button
          class="bg-neutral-800 text-white border border-neutral-600 px-2 py-1 rounded text-sm hover:enabled:bg-neutral-700"
          on:click={() => regenerate(email)}
          disabled={regenerating[email.id] || loading}
          aria-label="Triage this email"
        >
          Triage
        </button>
        <button
          class="ml-auto bg-neutral-800 text-white border border-neutral-600 px-2 py-1 rounded text-sm hover:enabled:bg-neutral-700"
          on:click={() => (collapsed[email.id] = !collapsed[email.id])}
        >
          {collapsed[email.id] ? 'Expand' : 'Collapse'}
        </button>
        {#if regenerating[email.id]}
          <span class="text-xs text-neutral-400">Regenerating…</span>
        {/if}
      </div>

      {#if !collapsed[email.id]}
        <div class="mt-3 space-y-2">
          <p><strong>From:</strong> {email.sender}</p>
          <p class="flex items-center gap-2">
            <strong>Summary:</strong>
            <span>{results[email.id]?.summary ?? ''}</span>
            {#if results[email.id]?.summary === 'Thinking...'}
              <!-- Spinner -->
              <svg class="animate-spin h-4 w-4 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
            {/if}
          </p>
          {#if i < 3}
            <p class="font-semibold">✍️ Draft:</p>
            <pre class="bg-neutral-800 p-3 rounded-md whitespace-pre-wrap overflow-x-auto">{results[email.id]?.draft ?? ''}</pre>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</main>


