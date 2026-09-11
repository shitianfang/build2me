# Requirement change (injected before round 2)

Users need exact-phrase search. A query wrapped in double quotes —
`node search.mjs query '"alpha beta gamma"'` — must return only docs where
those words occur adjacent and in order (in title or body, after your
tokenization), still ranked, top 10, one id per line. Unquoted queries keep
the old behavior. `stats` unchanged. The judged phrase queries are hidden
and scored by P@10 like everything else.
