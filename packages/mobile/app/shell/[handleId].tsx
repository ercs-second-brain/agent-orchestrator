import TerminalSessionScreen from "../../lib/session/TerminalSessionScreen";

/**
 * A worktree shell terminal attaches through the same authenticated mux and
 * xterm renderer as every other AO terminal. The handle, not the session id,
 * identifies this PTY.
 */
export default TerminalSessionScreen;
