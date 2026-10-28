// Loaded explicitly by Skiff; standalone pi sessions keep their default prompt.
const MODEL_LOOKUP_HINT = "You can inspect PI_* environment variables for current model and session details.";

export default function systemPrompt(pi) {
	pi.on("before_agent_start", (event) => {
		const guidelines = event.systemPromptOptions?.toolGuidelines;
		if (!guidelines) return;
		// Edit the structured tool contribution, not the rendered prompt: user
		// instructions, project context, skills and other tool rules stay intact.
		for (const tool of ["bash", "powershell"]) {
			if (guidelines[tool]) {
				guidelines[tool] = guidelines[tool].filter((rule) => rule.trim() !== MODEL_LOOKUP_HINT);
			}
		}
	});
}
