# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-02
- Primary product surfaces: single-page game client portfolio (`index.html`, `style.css`, `main.js`)
- Evidence reviewed: existing page sections, MemoryStone screenshots under `assets/gamelab/memorystone/`, previous project screenshots, resume/contact summary.

## Brand
- Personality: calm, practical, game-dev focused, slightly warm.
- Trust signals: playable builds, demo videos, concrete implemented systems, project screenshots.
- Avoid: overly declarative self-praise, dense text blocks, making older projects compete with MemoryStone.

## Product goals
- Goals: make MemoryStone the clear hero project; show Unity client implementation ability; keep AI-assisted production as supporting context.
- Non-goals: a full resume replacement, exhaustive project archive, or visual-heavy gallery with little explanation.
- Success signals: MemoryStone is understood first; previous projects read as concise background; copy feels simple and readable.

## Personas and jobs
- Primary personas: game studio reviewers, recruiters, collaborators.
- User jobs: quickly understand candidate focus, see representative project quality, verify implementation experience.
- Key contexts of use: desktop portfolio review first, mobile skim second.

## Information architecture
- Primary navigation: Positioning → MemoryStone → Game Projects → How I Work → Resume → Contact.
- Core routes/screens: one-page portfolio.
- Content hierarchy: hero and MemoryStone first; earlier games are supporting evidence.

## Design principles
- Principle 1: lead with playable evidence, then explain briefly.
- Principle 2: keep copy calm and specific.
- Tradeoffs: prioritize MemoryStone depth over equal weight across all projects.

## Visual language
- Color: dark base with warm yellow accents and small cool highlights.
- Typography: large balanced headings, generous Korean line-height, short paragraphs.
- Spacing/layout rhythm: roomy hero and MemoryStone section; more compact previous project cards.
- Shape/radius/elevation: soft rounded panels, restrained shadows.
- Motion: subtle reveal and hover only.
- Imagery/iconography: use real MemoryStone gameplay screenshots prominently; keep older screenshots secondary.

## Components
- Existing components to reuse: hero card, feature media/copy, thumbnail gallery, project cards, link pills, lightbox.
- New/changed components: MemoryStone `photo-strip`, compact previous project notes.
- Variants and states: hover/focus states for buttons and image thumbnails.
- Token/component ownership: CSS custom properties in `style.css`.

## Accessibility
- Target standard: practical WCAG-minded readability.
- Keyboard/focus behavior: image buttons and lightbox close retain visible focus.
- Contrast/readability: high-contrast text on dark panels.
- Screen-reader semantics: descriptive Korean alt text for project images.
- Reduced motion and sensory considerations: no required motion for comprehension.

## Responsive behavior
- Supported breakpoints/devices: desktop, tablet, mobile via existing media queries.
- Layout adaptations: hero, MemoryStone, and project cards collapse to one column.
- Touch/hover differences: image buttons remain tappable without hover dependency.

## Interaction states
- Loading: static page, images load natively.
- Empty: not applicable.
- Error: external links may fail outside page control.
- Success: lightbox opens selected screenshot and returns focus on close.
- Disabled: not applicable.
- Offline/slow network: local assets render; external links require network.

## Content voice
- Tone: simple, modest, direct but not forceful.
- Terminology: use MemoryStone/기억결, Unity/C#, 카드, 제한 시야, 턴제 전술 consistently.
- Microcopy rules: avoid repeated “~하고 싶습니다” where a plain description is clearer; keep older project learnings to one short note.

## Implementation constraints
- Framework/styling system: static HTML/CSS/vanilla JS.
- Design-token constraints: extend existing CSS variables, no new dependency.
- Performance constraints: avoid adding large generated assets; reuse provided screenshots.
- Compatibility constraints: plain browser-compatible JavaScript.
- Test/screenshot expectations: verify HTML parses and local page renders without missing referenced local assets.

## Open questions
- [ ] If a final target company/role is chosen, tune the hero line and project emphasis to that job description.
