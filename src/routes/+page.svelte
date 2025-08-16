<script lang="ts">
  import { mockEmails } from '$lib/mockEmails';
  import { generateEmailDraft } from '$lib/gpt';

  type EmailDraft = {
    summary: string;
    score: number;
    draft: string;
  };

  let results: Record<string, EmailDraft> = {};
  let loading = false;

  async function runTriage() {
    loading = true;
    results = {};

    for (const email of mockEmails) {
      results[email.id] = {
        summary: 'Thinking...',
        score: 0,
        draft: ''
      };

      const parsed = await generateEmailDraft(email);
      results[email.id] = parsed;
    }

    loading = false;
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
      <p><strong>Summary:</strong> {results[email.id].summary}</p>
      <p><strong>Score:</strong> {results[email.id].score}</p>
      {#if i < 3}
        <p class="font-semibold">✍️ Draft:</p>
        <pre class="bg-neutral-800 p-3 rounded-md whitespace-pre-wrap overflow-x-auto">{results[email.id].draft}</pre>
      {/if}
    </div>
  {/each}
</main>

