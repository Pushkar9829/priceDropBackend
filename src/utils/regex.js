/** Escape user input so it is matched literally inside a RegExp. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive "contains" matcher for untrusted search input (capped length). */
const containsRegex = (s) => new RegExp(escapeRegex(String(s).slice(0, 100)), 'i');

module.exports = { escapeRegex, containsRegex };
