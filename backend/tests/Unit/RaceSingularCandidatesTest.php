<?php

namespace Tests\Unit;

use App\Console\Commands\EtlKillStatistics;
use Tests\TestCase;

/**
 * The killstatistics race name → lore entry matcher.
 *
 * TibiaData reports races in lowercase plural and our entries are singular, so
 * this mapping is what makes every kill chart, boss watch and hunt ranking point
 * at a real creature page. The cases below are the ones prod actually failed on
 * (224 unlinked races, ~1.6% of all kills), so they are regression cases, not
 * hypotheticals.
 */
class RaceSingularCandidatesTest extends TestCase
{
    /** @param list<string> $names */
    private function assertResolves(string $race, string $entry): void
    {
        $this->assertContains(
            $entry,
            EtlKillStatistics::singularCandidates($race),
            "'{$race}' should offer '{$entry}' as a candidate"
        );
    }

    public function test_plain_plurals_still_work(): void
    {
        $this->assertResolves('demons', 'demon');
        $this->assertResolves('mummies', 'mummy');
        $this->assertResolves('wolves', 'wolf');
        $this->assertResolves('medusae', 'medusa');
    }

    public function test_the_exact_name_is_always_a_candidate(): void
    {
        // Proper-noun bosses the inflector would mangle must survive untouched.
        $this->assertResolves('cyclops', 'cyclops');
        $this->assertResolves('ferumbras', 'ferumbras');
    }

    public function test_head_noun_plurals_before_of(): void
    {
        $this->assertResolves('hands of cursed fate', 'hand of cursed fate');
        $this->assertResolves('sparks of destruction', 'spark of destruction');
        $this->assertResolves('priestesses of the wild sun', 'priestess of the wild sun');
        $this->assertResolves('memories of a carnisylvan', 'memory of a carnisylvan');
        $this->assertResolves('memories of an ogre', 'memory of an ogre');
        $this->assertResolves('minions of Versperoth', 'minion of versperoth');
        $this->assertResolves('pillars of summoning', 'pillar of summoning');
    }

    public function test_ies_plurals_the_inflector_turns_into_y(): void
    {
        // Str::singular gives "pixy"/"valkyry"; the entries are Pixie/Valkyrie.
        $this->assertResolves('pixies', 'pixie');
        $this->assertResolves('valkyries', 'valkyrie');
        // …without losing the genuine -y words.
        $this->assertResolves('harpies', 'harpy');
    }

    public function test_irregular_plurals_the_inflector_does_not_know(): void
    {
        $this->assertResolves('sabreteeth', 'sabretooth');
        $this->assertResolves('muglex clan feetman', 'muglex clan footman');
        $this->assertResolves('cyclopes drone', 'cyclops drone');
        $this->assertResolves('cyclopes smith', 'cyclops smith');
        $this->assertResolves('animated cyclopes', 'animated cyclops');
    }

    public function test_singular_is_offered_before_the_literal_name(): void
    {
        // A plural-named duplicate entry ("Demons", a concept) must not beat the
        // real singular creature, so the singular has to be tried first.
        $candidates = EtlKillStatistics::singularCandidates('demons');
        $this->assertSame('demon', $candidates[0]);
        $this->assertSame('demons', $candidates[1]);
    }

    public function test_candidates_are_unique_and_lowercase(): void
    {
        $candidates = EtlKillStatistics::singularCandidates('Memories of a Wolf');
        $this->assertSame(array_values(array_unique($candidates)), $candidates);
        foreach ($candidates as $c) {
            $this->assertSame(mb_strtolower($c), $c);
        }
    }
}
