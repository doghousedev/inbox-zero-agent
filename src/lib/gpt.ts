type GPTParsedDraft = {
	summary: string;
	score: number;
	draft: string;
};

export async function generateEmailDraft(
	email: { subject: string; body: string },
	tone: 'Professional' | 'Friendly' | 'Brief' | 'Empathetic' = 'Professional'
): Promise<GPTParsedDraft> {
	const model = (import.meta.env.VITE_OPENAI_MODEL as string) || 'gpt-5-nano';
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
2. Score its importance from 1 to 10.
3. Write a reply in a ${tone} tone.

Tone guidance:
- Professional: formal, clear, courteous.
- Friendly: warm, approachable, positive.
- Brief: very concise, minimum words, keep essentials only.
- Empathetic: validating, supportive, considerate.

Return the output in this format:
Summary: ...
Score: ...
Draft: ...
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
			// Some models (e.g. gpt-5-nano) only support default temperature; omit when unsupported
			const supportsTemperature = !/^gpt-5-nano$/i.test(model);
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

	const summaryMatch = text.match(/Summary:\s*(.+)/i);
	const scoreMatch = text.match(/Score:\s*(\d+)/i);
	const draftMatch = text.match(/Draft:\s*([\s\S]*)/i);

	return {
		summary: summaryMatch?.[1]?.trim() ?? '[No summary]',
		score: parseInt(scoreMatch?.[1] ?? '0'),
		draft: draftMatch?.[1]?.trim() ?? '[No draft]'
	};
}
