-- A separate database for the Vitest `integration` project.
--
-- Separate rather than a schema inside `zentavio`, because the integration helper drops and
-- recreates everything it owns before each run. Sharing a database with development data would
-- make that destructive, and a test suite that can destroy a developer's data eventually does.
--
-- The helper additionally refuses any connection string whose database name does not end in
-- `_test`, so the guard does not depend on this file alone.

CREATE DATABASE zentavio_test OWNER zentavio;
