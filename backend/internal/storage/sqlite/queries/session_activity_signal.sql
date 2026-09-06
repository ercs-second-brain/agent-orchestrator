-- name: UpdateSessionFromActivitySignal :execrows
-- Lifecycle reads the session before reducing a hook. Fence the resulting
-- narrow write against a concurrent ownership transfer, and reject every
-- callback while the still-projected owner is the source being torn down.
-- Target hooks remain allowed after atomic activation moves both the session
-- owner/generation and switch state out of these source-side phases.
UPDATE sessions SET
    activity_state = sqlc.arg(activity_state),
    activity_last_at = sqlc.arg(activity_last_at),
    first_signal_at = sqlc.arg(first_signal_at),
    agent_session_id = sqlc.arg(agent_session_id),
    agent_session_id_launch_id = sqlc.arg(agent_session_id_launch_id),
    latest_user_prompt = sqlc.arg(latest_user_prompt),
    latest_user_prompt_at = sqlc.arg(latest_user_prompt_at),
    latest_assistant_update = sqlc.arg(latest_assistant_update),
    native_transcript_path = sqlc.arg(native_transcript_path),
    updated_at = sqlc.arg(updated_at)
WHERE sessions.id = sqlc.arg(id)
  AND sessions.is_terminated = 0
  AND sessions.harness = sqlc.arg(expected_harness)
  AND sessions.session_mode = sqlc.arg(expected_session_mode)
  AND (
      (
          sqlc.arg(expected_session_mode) <> 'chat'
          AND sessions.runtime_launch_id = sqlc.arg(expected_runtime_launch_id)
      )
      OR
      (
          sqlc.arg(expected_session_mode) = 'chat'
          AND sessions.controller_generation = sqlc.arg(expected_controller_generation)
      )
  )
  AND NOT EXISTS (
      SELECT 1
      FROM agent_switches AS active_switch
      WHERE active_switch.session_id = sessions.id
        AND active_switch.from_harness = sessions.harness
        AND active_switch.state IN (
            'stopping_source', 'source_stopped', 'starting_target'
        )
  );

