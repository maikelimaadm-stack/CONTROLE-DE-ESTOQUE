# Brand Guidelines — Agro ERP

> Last updated: 2026-10-26
> Status: Active
> Source of truth for runtime UI tokens: `apps/web/src/app/globals.css` (`--mg-*`).
> This document records the brand already shipping in the shell; it does not invent a second palette.

## Quick Reference

| Element | Value |
|---------|-------|
| Primary Color | #40DE63 |
| Secondary Color | #2899F5 |
| Accent Color | #15803D |
| Primary Font | DM Sans |
| Voice | Clear, operational, PT-BR |

## Brand Concept

**Theme:** Field Green Operational  
**Product:** Agro ERP — multi-company farm operations (compras, estoque, financeiro, vendas).  
**Mood:** trustworthy, dense, calm, productive — green top bar, light gray workspace, no navy/purple “AI default” skins.

The top navigation is the brand signal: accent green (`--mg-accent`) with white type. Mega-menus, focus rings and selection states reuse the same green tint (`--mg-accent-light`). Do not replace the shell with unrelated marketing palettes from external design packs.

---

## 1. Color Palette

### Primary Colors

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Agro Green | #40DE63 | rgb(64,222,99) | Top nav, primary CTA, selection accent (`--mg-accent`) |
| Agro Green Dark | #36C956 | rgb(54,201,86) | Hover on green controls (`--mg-accent-hover`) |
| Agro Green Light | #ECFDF3 | rgb(236,253,243) | Soft fill approximation of `--mg-accent-light` |

### Secondary Colors

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Sky Blue | #2899F5 | rgb(40,153,245) | Informational links / secondary cue (`--mg-blue`) |
| Field Green | #15803D | rgb(21,128,61) | Open module pill text, active tab ink |

### Accent Colors

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Field Green | #15803D | rgb(21,128,61) | Emphasis on active navigation chrome |
| Brand 600 | #22A85C | rgb(34,168,92) | Tailwind `--color-brand-600` scale (supporting) |

### Neutral Palette

| Name | Hex | Usage |
|------|-----|-------|
| Ink | #111827 | Primary text (`--mg-text-1`) |
| Muted | #6B7280 | Secondary text (`--mg-text-2`) |
| Quiet | #9CA3AF | Captions / group labels (`--mg-text-3`) |
| Page | #F0F2F5 | App background (`--mg-bg-page`) |
| Card | #FFFFFF | Surfaces (`--mg-bg-card`) |
| Divider | #E7EAEE | Borders (`--mg-divider`) |
| Icon | #5B6B80 | Icon stroke (`--mg-icon`) |

### Semantic Colors

| State | Hex | Usage |
|-------|-----|-------|
| Success | #40DE63 | Positive / brand-aligned success |
| Warning | #F59E0B | Cautions, pending |
| Error | #DC2626 | Destructive (`--mg-red`) |
| Info | #2899F5 | Informational (`--mg-blue`) |

### Accessibility

- Body text on white: ≥ 4.5:1
- Interactive non-text (icons, focus ring) target ≥ 3:1 against adjacent surfaces
- Focus on green topnav uses white outline (`outline: 2px solid #fff`) so it stays visible on `--mg-accent`
- Mega-menu focus uses `--mg-focus-border` / accent-light fill — never remove focus without a replacement

---

## 2. Typography

### Font Stack

```css
--font-heading: var(--font-dm-sans), "DM Sans", ui-sans-serif, system-ui, sans-serif;
--font-body: var(--font-dm-sans), "DM Sans", ui-sans-serif, system-ui, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

Do not introduce Inter, Roboto, Fira Sans, or navy/serif “enterprise pack” substitutions that fight the shell.

### Type Scale (dense ERP chrome)

| Element | Size | Weight | Notes |
|---------|------|--------|-------|
| Brand name (topnav) | 12.5px | 700 | White on green |
| Module pill | 12.5px | 500 / 700 current | White / open = Field Green on white |
| Mega group label | 10px | 700 | Uppercase, letter-spacing .08em |
| Mega item label | 12.5px | 500 / 600 current | — |
| Mega item hint | 10.5px | 500 | `--mg-text-3` |
| Body / fields | 13px | 500 | Forms |

---

## 3. Logo Usage

| Variant | Use |
|---------|-----|
| Hexagon mark + “Agro ERP” | TopNavigation brand link |
| Mark only | Narrow breakpoints (brand name hidden ≤1023px) |

Clear space ≈ mark width. Do not recolor the mark off-white on the green bar. Do not replace with emoji or third-party mascots.

---

## 4. Voice & Tone

### Brand Personality

| Trait | Description |
|-------|-------------|
| **Clear** | Short PT-BR labels; no anglicism when a common farm term exists |
| **Operational** | Speaks to daily work (documento, parcela, rateio), not marketing slogans |
| **Calm** | Errors explain the next step; never blame |
| **Precise** | Prefer the registry label over invented synonyms |

### Voice Chart

| Trait | We Are | We Are Not |
|-------|--------|------------|
| Clear | Direct, short | Vague, buzzword-heavy |
| Operational | Task-oriented | Lifestyle / hype |
| Calm | Solution-focused | Alarmist |
| Precise | Same word as the screen | Parallel slang |

### Tone by Context

| Context | Tone | Example |
|---------|------|---------|
| Navigation | Neutral, scannable | “Documentos” + hint “Lista com filtro por tipo” |
| Empty states | Helpful | “Nenhuma função encontrada.” |
| Errors | Calm, next step | “Tente de novo ou fale com o administrador.” |
| Success | Brief | “Favoritos atualizados” |

### Prohibited Terms

| Avoid | Reason |
|-------|--------|
| Seamless / revolutionary | Marketing fluff |
| Synergy / leverage | Corporate jargon |
| Invented module nicknames | Breaks search / SSOT `nav.registry` |

---

## 5. Imagery & Icons

- Structural icons: Lucide outline, consistent stroke (~1.5–2), sizes 12–14px in chrome, `aria-hidden` when beside visible text.
- No emoji as navigation icons.
- Decorative gradients are not a substitute for the green brand bar.

---

## 6. Design Components (shell)

| Type | Token / rule |
|------|----------------|
| Primary button | `--mg-accent` / hover `--mg-accent-hover`, white text |
| Module open | White pill, text `#15803d` |
| Mega item hover/current | `--mg-accent-light` fill, ink `--mg-text-1` |
| Radius control / card | 8px / 12px (`--mg-radius-control` / `--mg-radius-card`) |
| Spacing rhythm | 4 / 6 / 8 / 12 / 16 (dense ERP) |

---

## AI Image Generation

### Base Prompt Template

```
Agro ERP product UI, field-green accent #40DE63, light gray workspace #F0F2F5, white cards, DM Sans, dense farm operations software, calm and trustworthy, no purple gradients, no neon glow
```

### Style Keywords

| Category | Keywords |
|----------|----------|
| Lighting | Soft daylight, even UI lighting |
| Mood | Calm, productive, trustworthy |
| Composition | Dense toolbar + table, green top bar dominant |
| Treatment | Clean, high legibility, minimal chrome |
| Aesthetic | Operational ERP, not marketing landing |

### Visual Don'ts

| Avoid | Reason |
|-------|--------|
| Purple-on-white / indigo SaaS kits | Fights live shell |
| Navy + Fira “enterprise” packs | External pack anti-pattern here |
| Dark mode by default | Shell is light |
| Emoji nav | Inconsistent, non-token |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-10-26 | Document live Agro ERP brand from `--mg-*` / DM Sans; guide mega-menu Compras polish |
