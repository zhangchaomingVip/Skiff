import type { GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { GenerationControls } from "./GenerationWorkspace";
import { SegmentedControl } from "./ui";
import "./generation-workspace.css";

/** The studio's single creation surface, pinned to the foot of the flow like a
 *  chat composer. Submitting never swaps the page: the new turn lands directly
 *  above the card, and the draft plus reference stay where the user left them. */
export function StudioPromptHero({ kind, studio, onKind, onConfigure }: {
	kind: GenerationKind;
	studio: GenerationStudio;
	onKind: (kind: GenerationKind) => void;
	onConfigure: () => void;
}) {
	return <section className="studio-home" aria-label="创作台">
		<div className="design-composer" data-variant="hero">
			<GenerationControls
				kind={kind}
				studio={studio}
				onConfigure={onConfigure}
				variant="hero"
				modeSwitch={<SegmentedControl label="创作类型" value={kind} onChange={onKind} options={[{ value: "image", label: "图片" }, { value: "video", label: "视频" }]} />}
			/>
		</div>
	</section>;
}
