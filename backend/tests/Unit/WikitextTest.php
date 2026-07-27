<?php

namespace Tests\Unit;

use App\Support\Wikitext;
use PHPUnit\Framework\TestCase;

class WikitextTest extends TestCase
{
    public function test_strips_a_stray_closing_brace_pair(): void
    {
        $this->assertSame('', Wikitext::tidy(Wikitext::stripTemplates('}}')));
    }

    public function test_strips_an_unterminated_template_and_keeps_the_prose_before_it(): void
    {
        $text = "Once on an Ice Island, passage back is free.\n {{TransportList\n |\n |\n |";

        $this->assertSame(
            'Once on an Ice Island, passage back is free.',
            Wikitext::tidy(Wikitext::stripTemplates($text)),
        );
    }

    public function test_strips_nested_and_multiline_templates(): void
    {
        $text = "Part of the Ornate Set.\n{{Loot Statistics\n|version={{OfficialVersion|13.10}}\n}}";

        $this->assertSame(
            'Part of the Ornate Set.',
            Wikitext::tidy(Wikitext::stripTemplates($text)),
        );
    }

    public function test_leaves_plain_prose_untouched(): void
    {
        $text = "A pair of greaves.\n\nWorn by falconers.";

        $this->assertSame($text, Wikitext::tidy(Wikitext::stripTemplates($text)));
    }

    public function test_an_unterminated_template_does_not_eat_the_next_paragraph(): void
    {
        $text = "Found in: Under Darashia crypt, {{Mapper Coords|129.246|126.153|12|2\n\nBehaviour: Summons a Bonebeast.";

        $this->assertSame(
            "Found in: Under Darashia crypt\n\nBehaviour: Summons a Bonebeast.",
            Wikitext::tidy(Wikitext::stripTemplates($text)),
        );
    }

    public function test_drops_the_separator_a_removed_template_dangled_off(): void
    {
        $text = 'Sails to (premium only): {{TransportList';

        $this->assertSame('Sails to (premium only)', Wikitext::tidy(Wikitext::stripTemplates($text)));
    }

    public function test_keeps_a_template_removed_mid_sentence_readable(): void
    {
        $text = 'Talk to {{NPC|Flora}} in Rathleton to enter.';

        $this->assertSame('Talk to in Rathleton to enter.', Wikitext::tidy(Wikitext::stripTemplates($text)));
    }

    public function test_blank_detects_punctuation_only_residue(): void
    {
        $this->assertTrue(Wikitext::isBlank(" .\n| |"));
        $this->assertFalse(Wikitext::isBlank('Arm 10'));
    }
}
