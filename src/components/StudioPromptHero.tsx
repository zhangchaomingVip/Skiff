import type { GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { GenerationControls } from "./GenerationWorkspace";
import "./generation-workspace.css";

/** The studio's single creation surface, pinned to the foot of the flow like a
 *  chat composer. Submitting never swaps the page: the new turn lands directly
 *  above the card, and the draft plus reference stay where the user left them. */
export function StudioPromptHero({ kind, studio, onConfigure, onOpenHistory }: {
	kind: GenerationKind;
	studio: GenerationStudio;
	onConfigure: () => void;
	onOpenHistory?: () => void;
}) {
	return <section className="studio-home" aria-label="创作台">
		<div className="design-composer" data-variant="hero">
			<GenerationControls
				kind={kind}
				studio={studio}
				onConfigure={onConfigure}
				onOpenHistory={onOpenHistory}
				variant="hero"
			/>
		</div>
	</section>;
}
