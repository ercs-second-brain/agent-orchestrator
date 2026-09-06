import {
	AgentAvatar as ProductAgentAvatar,
	type AgentAvatarProps,
	type AgentLogoSources,
} from "@ercs-second-brain/product-ui";
import piLogo from "../assets/agents/pi.png";

// Real brand logos keyed by the harness name AO stores on session.provider.
// Since ADR 0005 pi is the single supported harness; legacy provider values in
// historical session rows have no logo and fall back to a lettered tile.
const LOGOS: AgentLogoSources = {
	pi: piLogo,
};

/**
 * Agent mark for board/task cards: the harness's real brand logo rendered bare —
 * no tile, border, or background — so the brand's own shape shows.
 */
export function AgentAvatar(props: AgentAvatarProps) {
	return <ProductAgentAvatar {...props} logoSources={{ ...LOGOS, ...props.logoSources }} />;
}