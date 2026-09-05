import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import TerminalSessionScreen from "../../lib/session/TerminalSessionScreen";
import { useApp } from "../../lib/store";
import { useTheme, useThemedStyles } from "../../lib/ThemeProvider";
import type { Theme } from "../../lib/theme";

/**
 * Sessions are terminal-first: the daemon's tmux TUI is the agent interface, and
 * the phone mirrors it through the mux. A `mode: "chat"` row can still exist in
 * daemon storage written before chat was removed; it has no live surface, so it
 * renders the notice below rather than guessing a renderer.
 */
export default function MobileSessionRoute() {
	const { id: rawId } = useLocalSearchParams<{ id: string }>();
	const id = String(rawId ?? "");
	const { sessions, orchestrators, loading, refresh } = useApp();
	const session = sessions.find((item) => item.id === id) ?? orchestrators.find((item) => item.id === id);
	const [resolving, setResolving] = useState(!session);
	const t = useTheme();
	const styles = useThemedStyles(makeStyles);

	// A notification can deep-link into a session before the board's next poll has
	// populated it. Resolve the daemon-owned mode before choosing a renderer; never
	// guess TUI merely because the local cache is cold.
	useEffect(() => {
		if (session) {
			setResolving(false);
			return;
		}
		let cancelled = false;
		setResolving(true);
		void refresh().finally(() => {
			if (!cancelled) setResolving(false);
		});
		return () => { cancelled = true; };
	}, [id, refresh, session]);

	if (session?.mode === "tui") return <TerminalSessionScreen />;
	if (session?.mode === "chat") {
		return (
			<View style={styles.center}>
				<Text style={styles.copy}>Chat sessions are no longer supported. Open the session terminal on desktop.</Text>
			</View>
		);
	}

	return (
		<View style={styles.center}>
			{loading || resolving ? <ActivityIndicator color={t.blue} /> : <Text style={styles.copy}>Session not found.</Text>}
		</View>
	);
}

const makeStyles = (t: Theme) =>
	StyleSheet.create({
		center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bgBase },
		copy: { color: t.textSecondary, fontSize: 14 },
	});
