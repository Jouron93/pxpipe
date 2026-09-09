import { describe, it, expect } from 'vitest';
import { renderModelsFragment, formatContextBadge } from '../src/dashboard/fragments.js';
import { getAllModelProfiles, resolveModelProfile } from '../src/core/model-registry.js';

describe('Empirical Verification Challenger Milestone 3-1: renderModelsFragment', () => {
  it('Requirement 1: HTML fragment output contains exactly 5 distinct section containers', () => {
    const html = renderModelsFragment(['claude-fable-5'], [], true);

    // Match all <div class="models"> containers
    const containers = html.match(/<div class="models">/g);
    expect(containers).not.toBeNull();
    expect(containers!.length).toBe(5);

    // Verify each expected family section label is present inside the HTML fragment
    expect(html).toContain('<span class="models-label">claude-john-20x / claude-orn-pro</span>');
    expect(html).toContain('<span class="models-label">codex-john / codex-orn</span>');
    expect(html).toContain('<span class="models-label">xai-oauth-grok</span>');
    expect(html).toContain('<span class="models-label">Image AGY Proxy models</span>');
    expect(html).toContain('<span class="models-label">Image NVIDIA NIM Flagships</span>');
  });

  it('Requirement 2: Context length badges (1M, 2M, 262K, 128K) appear inside <span class="badge-ctx">', () => {
    const html = renderModelsFragment(['claude-fable-5'], [], true);

    // Extract all <span class="badge-ctx">...</span> elements
    const badgeMatches = [...html.matchAll(/<span class="badge-ctx">([^<]+)<\/span>/g)].map(m => m[1]);
    expect(badgeMatches.length).toBeGreaterThan(0);

    const badgeSet = new Set(badgeMatches);

    // Verify the 4 mandatory context length badges appear in the rendered badge set
    expect(badgeSet.has('1M')).toBe(true);
    expect(badgeSet.has('2M')).toBe(true);
    expect(badgeSet.has('262K')).toBe(true);
    expect(badgeSet.has('128K')).toBe(true);

    // Verify exact badge matches for specific models across all families:
    // 1. Claude Family (1M)
    expect(html).toContain('claude-john-fable<span class="badge-ctx">1M</span>');
    expect(html).toContain('claude-john|orn-opus<span class="badge-ctx">1M</span>');

    // 2. OpenAI / Codex Family (262K, 1M)
    expect(html).toContain('codex-john|orn-sol<span class="badge-ctx">262K</span>');
    expect(html).toContain('GPT 5.5<span class="badge-ctx">1M</span>');

    // 3. Grok Family (524K, 1M, 500K)
    expect(html).toContain('Grok 4.5<span class="badge-ctx">524K</span>');
    expect(html).toContain('Grok 4.3<span class="badge-ctx">1M</span>');

    // 4. AGY Proxy Family (1M Flash, 2M Pro, 1M, 128K). Flash 3.5-3.8 are 1,048,576 ctx
    //    (DeepMind model cards, 2026-09-05); the 2M badge belongs to 3.1 Pro.
    expect(html).toContain('AGY Gemini 3.6 Flash (High)<span class="badge-ctx">1M</span>');
    expect(html).toContain('AGY Gemini 3.8 Flash (High)<span class="badge-ctx">1M</span>');
    expect(html).toContain('AGY Gemini 3.1 Pro (High)<span class="badge-ctx">2M</span>');
    expect(html).toContain('AGY Claude Opus 4.6 Thinking<span class="badge-ctx">1M</span>');
    expect(html).toContain('AGY GPT-OSS 120B (Medium)<span class="badge-ctx">128K</span>');

    // 5. NVIDIA NIM Family (1M, 262K, 128K)
    expect(html).toContain('Nemotron 3 Ultra 550B<span class="badge-ctx">1M</span>');
    expect(html).toContain('Nemotron 3 Super 120B<span class="badge-ctx">262K</span>');
    expect(html).toContain('Meta Llama 3.3 70B<span class="badge-ctx">128K</span>');
    expect(html).toContain('StarCoder2 15B<span class="badge-ctx">128K</span>');
  });

  it('formatContextBadge correctly maps raw token values to compact badges', () => {
    expect(formatContextBadge(2_097_152)).toBe('2M');
    expect(formatContextBadge(1_048_576)).toBe('1M');
    expect(formatContextBadge(1_050_000)).toBe('1M');
    expect(formatContextBadge(1_000_000)).toBe('1M');
    expect(formatContextBadge(524_288)).toBe('524K');
    expect(formatContextBadge(500_000)).toBe('500K');
    expect(formatContextBadge(262_144)).toBe('262K');
    expect(formatContextBadge(200_000)).toBe('200K');
    expect(formatContextBadge(131_072)).toBe('128K');
    expect(formatContextBadge(128_000)).toBe('128K');
  });
});
