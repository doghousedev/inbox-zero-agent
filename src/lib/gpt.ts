type GPTParsedDraft = {
  summary: string;
  score: number;
  category: 'Important' | 'Low Priority' | 'Promotional' | 'Spam' | 'Subscription';
  draft: string;
};

export type TriageModel = {
  id: string; // API model id
  label: string; // UI label
};

// Built-in set used for comparison mode
export const TRIAGE_MODELS: TriageModel[] = [
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'gpt-5-mini', label: 'GPT-5-mini' },
  { id: 'gpt-5-nano', label: 'GPT-5-nano' },
  { id: 'gpt-4o', label: 'GPT-4o' }
];

export async function generateEmailDraft(
	email: { subject: string; body: string },
	tone: 'Professional' | 'Friendly' | 'Brief' | 'Empathetic' = 'Professional',
	modelOverride?: string
): Promise<GPTParsedDraft> {
	const model = modelOverride || ((import.meta.env.VITE_OPENAI_MODEL as string) || 'gpt-5-nano');
	type OpenAIChatResponse = {
		choices?: Array<{ message?: { content?: string } }>;
		error?: { message?: string };
	};
	const prompt = `
You are a smart email assistant. Here's an email:

Subject: ${email.subject}
Body: ${email.body}

Tasks:
1. Summarize the email in one sentence.
2. Score its importance from 1 to 10 (integer).
3. Classify the email into one Category: Important | Low Priority | Promotional | Spam | Subscription.
4. Write a reply in a ${tone} tone.

Tone guidance:
- Professional: formal, clear, courteous.
- Friendly: warm, approachable, positive.
- Brief: very concise, minimum words, keep essentials only.
- Empathetic: validating, supportive, considerate.

Return ONLY a fenced yaml block with exactly these keys:
\`\`\`yaml
Summary: <one-sentence summary>
Score: <1-10 integer>
Category: <Important | Low Priority | Promotional | Spam | Subscription>
Draft: <your reply>
\`\`\`
`;

	const res = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${import.meta.env.VITE_OPENAI_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify((() => {
			const payload: Record<string, unknown> = {
				model,
				messages: [{ role: 'user', content: prompt }]
			};
			// Some gpt-5 variants only support default temperature; omit when unsupported
			const supportsTemperature = !/^gpt-5-/i.test(model);
			if (supportsTemperature) {
				const tempEnv = import.meta.env.VITE_OPENAI_TEMPERATURE as string | undefined;
				const temperature = tempEnv !== undefined ? Number(tempEnv) : 0.5;
				payload.temperature = temperature;
			}
			return payload;
		})())
	});
	let data: OpenAIChatResponse;
	try {
		data = (await res.json()) as OpenAIChatResponse;
	} catch {
		throw new Error(`OpenAI response was not JSON (status ${res.status})`);
	}

	if (!res.ok) {
		const message = data?.error?.message || JSON.stringify(data);
		throw new Error(`OpenAI error ${res.status}: ${message}`);
	}

	const text: string = data?.choices?.[0]?.message?.content ?? '';

  // Try to extract fenced YAML block
  const fenceMatch = text.match(/```\s*yaml\s*\n([\s\S]*?)\n```/i) || text.match(/```\s*\n([\s\S]*?)\n```/i);
  let summary = '';
  let score = 0;
  let category: GPTParsedDraft['category'] = 'Low Priority';
  let draft = '';

  const parseLooseYaml = (yaml: string) => {
    const lines = yaml.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = m[2] ?? '';
      if (key === 'summary') {
        summary = value.trim();
      } else if (key === 'score') {
        const num = parseInt(value.trim(), 10);
        if (!Number.isNaN(num)) score = num;
      } else if (key === 'category') {
        const v = value.trim();
        const allowed = ['Important','Low Priority','Promotional','Spam','Subscription'] as const;
        const match = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
        if (match) category = match;
      } else if (key === 'draft') {
        // Draft may span multiple lines; capture remainder of current line and following lines
        const rest = [value, ...lines.slice(i + 1)].join('\n');
        draft = rest.trim();
        break;
      }
    }
  };

  if (fenceMatch) {
    parseLooseYaml(fenceMatch[1]);
  } else {
    // Fallback regex parsing
    const summaryMatch = text.match(/Summary:\s*(.+)/i);
    const scoreMatch = text.match(/Score:\s*(\d+)/i);
    const categoryMatch = text.match(/Category:\s*(.+)/i);
    const draftMatch = text.match(/Draft:\s*([\s\S]*)/i);
    summary = summaryMatch?.[1]?.trim() ?? '';
    score = parseInt(scoreMatch?.[1] ?? '0', 10) || 0;
    const v = categoryMatch?.[1]?.trim() ?? '';
    const allowed = ['Important','Low Priority','Promotional','Spam','Subscription'] as const;
    const match = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
    category = match || 'Low Priority';
    draft = draftMatch?.[1]?.trim() ?? '';
  }

  if (!summary) summary = '[No summary]';
  if (!draft) draft = '[No draft]';

  return { summary, score, category, draft };
}

export async function generateEmailDraftMulti(
  email: { subject: string; body: string },
  tone: 'Professional' | 'Friendly' | 'Brief' | 'Empathetic' = 'Professional',
  models: string[] = TRIAGE_MODELS.map((m) => m.id)
): Promise<Record<string, GPTParsedDraft>> {
  const settled = await Promise.allSettled(
    models.map((m) => generateEmailDraft(email, tone, m).then((r) => ({ model: m, result: r })))
  );
  const out: Record<string, GPTParsedDraft> = {};
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      out[s.value.model] = s.value.result;
    } else {
      const reason = (s as PromiseRejectedResult).reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      // We cannot reliably know which model failed here; skip adding or tag generically
      // For visibility, we add a placeholder under a synthetic key
      out['error'] = { summary: '[Error] Failed to generate', score: 0, category: 'Low Priority', draft: msg };
    }
  }
  return out;
}

