type GPTParsedDraft = {
	summary: string;
	score: number;
	draft: string;
};

export async function generateEmailDraft(email: {
	subject: string;
	body: string;
}): Promise<GPTParsedDraft> {
	const prompt = `
You are a smart email assistant. Here's an email:

Subject: ${email.subject}
Body: ${email.body}

Tasks:
1. Summarize the email in one sentence.
2. Score its importance from 1 to 10.
3. Write a polite and professional reply.

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
		body: JSON.stringify({
			model: 'gpt-4o',
			messages: [{ role: 'user', content: prompt }],
			temperature: 0.5
		})
	});

	const text = await res.json().then((d) => d.choices?.[0]?.message?.content ?? '');

	const summaryMatch = text.match(/Summary:\s*(.+)/i);
	const scoreMatch = text.match(/Score:\s*(\d+)/i);
	const draftMatch = text.match(/Draft:\s*([\s\S]*)/i);

	return {
		summary: summaryMatch?.[1]?.trim() ?? '[No summary]',
		score: parseInt(scoreMatch?.[1] ?? '0'),
		draft: draftMatch?.[1]?.trim() ?? '[No draft]'
	};
}
