package com.idento.data.network

/**
 * True when the running binary is a debug build. Used to gate dev-only behaviour
 * (verbose HTTP logging, pointing at a local dev server) so release builds are
 * secure by default.
 */
expect fun isDebugBuild(): Boolean
