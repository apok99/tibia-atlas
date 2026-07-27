<?php

namespace App\Support;

/**
 * Shared wikitext scrubbing used by every TibiaWiki importer.
 *
 * The importers each parse a different infobox, but they all end up with the
 * same hazard: a `{{Template}}` call that a regex cannot match because it spans
 * newlines, nests, or lost its closing braces to the field parser. Those
 * leftovers used to reach the site as descriptions like "}}" or
 * "{{TransportList | | |".
 */
final class Wikitext
{
    /** Internal placeholder marking where a template was removed. */
    private const MARK = "\x00";

    /**
     * Drop every `{{template}}` call by counting braces, so nested and
     * multi-line calls go too, along with a stray closing `}}`.
     *
     * A call whose closing braces are missing swallows the rest of its
     * paragraph (its arguments, the "| foo" continuation lines) but never
     * crosses a blank line — real prose after the residue survives.
     *
     * Where a call is removed mid-sentence and nothing follows it on the line,
     * the separator it dangled off ("Found in: the crypt, {{Mapper Coords…")
     * goes with it.
     */
    public static function stripTemplates(string $w): string
    {
        // Scan paragraph by paragraph so an unterminated call cannot reach past
        // a blank line. DELIM_CAPTURE keeps the original separators intact.
        $chunks = preg_split('/(\n[ \t]*\n)/', $w, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [$w];
        $out = '';
        foreach ($chunks as $i => $chunk) {
            $out .= $i % 2 === 1 ? $chunk : self::stripParagraph($chunk);
        }

        // Nothing follows on the line: the removed call takes with it whatever
        // it dangled off ("Found in: the crypt, {{Mapper Coords…", "the cliff
        // ({{Mapper Coords…").
        $out = preg_replace('/[ \t]*[,;:–—\-(\[]*[ \t]*'.self::MARK.'[ \t]*$/mu', '', $out) ?? $out;
        $out = preg_replace('/^[ \t]*'.self::MARK.'[ \t]*/m', '', $out) ?? $out;

        // Removed mid-sentence: leave exactly one space so words never collide.
        return preg_replace('/[ \t]*'.self::MARK.'[ \t]*/', ' ', $out) ?? str_replace(self::MARK, '', $out);
    }

    /** Brace-counting pass over a single paragraph. */
    private static function stripParagraph(string $w): string
    {
        $out = '';
        $depth = 0;
        $len = strlen($w);
        for ($i = 0; $i < $len; $i++) {
            if ($i + 1 < $len && $w[$i] === '{' && $w[$i + 1] === '{') {
                if ($depth === 0) {
                    $out .= self::MARK;
                }
                $depth++;
                $i++;

                continue;
            }
            if ($i + 1 < $len && $w[$i] === '}' && $w[$i + 1] === '}') {
                $depth = max(0, $depth - 1);
                $i++;

                continue;
            }
            if ($depth === 0) {
                $out .= $w[$i];
            }
        }

        return $out;
    }

    /**
     * True when the text carries nothing a reader could read — no letter and no
     * digit survived the scrub, so what is left is punctuation or pipe residue.
     */
    public static function isBlank(string $text): bool
    {
        return preg_match('/[\p{L}\p{N}]/u', $text) !== 1;
    }

    /**
     * Final tidy for a scrubbed passage: drop lines that are pure template
     * parameter residue ("|", "| foo = bar"), collapse runs of blank lines, and
     * return an empty string when nothing readable is left.
     */
    public static function tidy(string $text): string
    {
        $lines = array_filter(
            explode("\n", $text),
            fn (string $line) => ! preg_match('/^\s*\|/', $line),
        );
        $text = trim(preg_replace("/\n{3,}/", "\n\n", implode("\n", $lines)) ?? $text);
        // A passage can't end on a separator — whatever it introduced is gone.
        $text = rtrim($text, " \t,;:");

        return self::isBlank($text) ? '' : $text;
    }
}
