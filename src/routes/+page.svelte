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

<h1>📬 Inbox Zero Agent</h1>

<button on:click={runTriage} disabled={loading}>
  {loading ? 'Working...' : 'Triage My Inbox'}
</button>

{#each rankedEmails as email, i}
  <div style="margin-top: 1rem; padding: 1rem; border: 2px solid {i < 3 ? '#4caf50' : '#ccc'}; border-radius: 8px;">
    <h2>{email.subject}</h2>
    <p><strong>From:</strong> {email.sender}</p>
    <p><strong>Summary:</strong> {results[email.id].summary}</p>
    <p><strong>Score:</strong> {results[email.id].score}</p>
    {#if i < 3}
      <p><strong>✍️ Draft:</strong></p>
      <pre style="white-space: pre-wrap;">{results[email.id].draft}</pre>
    {/if}
  </div>
{/each}

<style>
  :global(body) {
    background-color: #121212;
    color: #e0e0e0;
    font-family: 'Inter', sans-serif;
    margin: 0;
    padding: 2rem;
  }

  h1 {
    font-size: 2rem;
    margin-bottom: 1rem;
    color: #90caf9;
  }

  button {
    background-color: #1f1f1f;
    color: #ffffff;
    border: 1px solid #444;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: bold;
  }

  button:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  button:hover:enabled {
    background-color: #333333;
  }

  div.email-card {
    background-color: #1e1e1e;
    border-radius: 8px;
    border: 2px solid #444;
    margin-top: 1rem;
    padding: 1rem;
    box-shadow: 0 0 10px #000;
  }

  div.email-card.top {
    border-color: #4caf50;
    background-color: #263238;
  }

  pre {
    background-color: #2b2b2b;
    padding: 0.75rem;
    border-radius: 6px;
    overflow-x: auto;
    white-space: pre-wrap;
  }
</style>

