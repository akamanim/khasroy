# Mobile Responsive Audit v1

Status: CANDIDATE / KNOWLEDGE (not VERIFIED)

Purpose: give Khasroy a deterministic first-pass checklist for finding commercially useful mobile UI problems before any subjective redesign.

## Checks

1. Reflow at 320 CSS px: normal page content must not require two-dimensional scrolling; content/functionality must remain available.
2. Text zoom: layout should tolerate text enlargement without clipping or losing core functionality.
3. Pointer targets: interactive targets should satisfy WCAG 2.2 minimum target sizing/spacing; prefer comfortable controls beyond the bare minimum for commercial mobile UI.
4. Responsive navigation: narrow layouts must keep primary navigation/actions usable rather than merely shrinking desktop navigation.
5. Content integrity: headings, CTA text, prices, forms and images must not be cut off or unnecessarily truncated on narrow screens.
6. Forms: labels, validation and input controls must remain readable and operable across devices.

## Evidence-backed sources

- W3C WAI, WCAG 2.1 Reflow (1.4.10): content should reflow at width equivalent to 320 CSS px without loss of information/functionality or two-dimensional scrolling (except genuinely two-dimensional content).
  https://www.w3.org/WAI/standards-guidelines/wcag/new-in-21/
- W3C WAI, WCAG 2.2 Target Size (Minimum) (2.5.8): pointer target minimum is 24x24 CSS px, with defined spacing/equivalent/inline/etc. exceptions.
  https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- W3C WAI developer tips: responsive design should adapt to viewport/zoom and avoid clipping/horizontal scrolling when text is enlarged.
  https://www.w3.org/WAI/tips/developing/
- web.dev Learn Forms: test forms across devices/platforms and keep forms usable/readable.
  https://web.dev/learn/forms

## Safe verification experiment for a future cycle

Against a local or disposable training page (never production):

- render at 320, 375, 768 and 1440 CSS px;
- programmatically compare document scrollWidth to viewport width;
- enumerate buttons/links/form controls and flag undersized bounding boxes;
- capture screenshots at each viewport;
- verify all primary CTA/form/navigation elements remain present and operable;
- record machine-readable findings plus screenshots as evidence.

Passing this experiment on at least one intentionally broken fixture and one corrected fixture is required before promoting this skill to VERIFIED.
