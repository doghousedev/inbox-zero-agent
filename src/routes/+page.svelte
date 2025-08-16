<script lang="ts">
  import { mockEmails } from '$lib/mockEmails';
  import { generateEmailDraft } from '$lib/gpt';

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

  // Initialize default tones to 'Professional'
  if (Object.keys(tones).length === 0) {
    for (const e of mockEmails) tones[e.id] = 'Professional';
  }

  async function runTriage() {
    loading = true;
    results = {};

    for (const email of mockEmails) {
      results[email.id] = {
        summary: 'Thinking...',
        score: 0,
        draft: ''
      };

      const selectedTone: Tone = tones[email.id] ?? 'Professional';
      const parsed = await generateEmailDraft(email, selectedTone);
      results[email.id] = parsed;
    }

    loading = false;
  }

  async function regenerate(email: { id: string; subject: string; body: string }) {
    const id = email.id;
    regenerating[id] = true;
    results[id] = { summary: 'Thinking...', score: 0, draft: '' };
    const selectedTone: Tone = tones[id] ?? 'Professional';
    const parsed = await generateEmailDraft(email, selectedTone);
    results[id] = parsed;
    regenerating[id] = false;
  }

  $: rankedEmails = [...mockEmails]
    .filter(e => results[e.id])
    .sort((a, b) => results[b.id].score - results[a.id].score);
</script>

<main class="p-8 max-w-4xl mx-auto">
  <h1 class="text-2xl mb-4 text-sky-300">📬 Inbox Zero Agent</h1>

  <button
    class="bg-neutral-800 text-white border border-neutral-600 px-4 py-2 rounded-md font-bold disabled:opacity-50 disabled:cursor-wait hover:enabled:bg-neutral-700"
    on:click={runTriage}
    disabled={loading}
  >
    {loading ? 'Working...' : 'Triage My Inbox'}
  </button>

  {#each rankedEmails as email, i}
    <div
      class="mt-4 p-4 rounded-lg border-2"
      class:border-green-500={i < 3}
      class:border-neutral-400={i >= 3}
    >
      <h2 class="text-lg font-semibold">{email.subject}</h2>
      <p><strong>From:</strong> {email.sender}</p>
      <div class="mt-2 flex items-center gap-2">
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
        {#if regenerating[email.id]}
          <span class="text-xs text-neutral-400">Regenerating…</span>
        {/if}
      </div>
      <p><strong>Summary:</strong> {results[email.id].summary}</p>
      <p><strong>Score:</strong> {results[email.id].score}</p>
      {#if i < 3}
        <p class="font-semibold">✍️ Draft:</p>
        <pre class="bg-neutral-800 p-3 rounded-md whitespace-pre-wrap overflow-x-auto">{results[email.id].draft}</pre>
      {/if}
    </div>
  {/each}
</main>

