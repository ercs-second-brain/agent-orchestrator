-- +goose Up
-- +goose StatementBegin
-- The cloud offering is gone: AO is local-first with the self-hosted remote
-- daemon as the only remote-access path. The persisted cloud toggle has no
-- reader anymore, so the column goes with it.
ALTER TABLE app_settings DROP COLUMN cloud_offering;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE app_settings
    ADD COLUMN cloud_offering INTEGER NOT NULL DEFAULT 0
        CHECK (cloud_offering IN (0, 1));
-- +goose StatementEnd
