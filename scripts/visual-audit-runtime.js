(function (global) {
  const MAX_TEXT_FINDINGS = 12;

  function selectorFor(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const dataRole = el.getAttribute('data-audit-role');
    if (dataRole) return `[data-audit-role="${dataRole}"]`;
    const classes = [...el.classList].slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
    return el.tagName.toLowerCase() + classes;
  }

  function visible(el, rect, style) {
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
  }

  function px(value) {
    const n = Number.parseFloat(value || '0');
    return Number.isFinite(n) ? n : 0;
  }

  function parseColor(value) {
    const match = String(value || '').match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length < 3 || parts.some((v, i) => i < 3 && !Number.isFinite(v))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
  }

  function backgroundFor(el) {
    let current = el;
    while (current && current.nodeType === 1) {
      const color = parseColor(global.getComputedStyle(current).backgroundColor);
      if (color && color.a > 0.05) return color;
      current = current.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function channel(v) {
    const x = Math.max(0, Math.min(255, v)) / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }

  function luminance(color) {
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }

  function contrastRatio(foreground, background) {
    if (!foreground || !background) return null;
    const l1 = luminance(foreground);
    const l2 = luminance(background);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function audit(options = {}) {
    const viewportWidth = options.viewportWidth || document.documentElement.clientWidth || global.innerWidth;
    const viewportHeight = options.viewportHeight || document.documentElement.clientHeight || global.innerHeight;
    const findings = [];

    function add(type, severity, category, details = {}) {
      findings.push({ type, severity, category, ...details });
    }

    const bodyStyle = global.getComputedStyle(document.body);
    const bodyFontSize = px(bodyStyle.fontSize) || 16;
    const visibleH1s = [...document.querySelectorAll('h1')].filter((el) => {
      const rect = el.getBoundingClientRect();
      return visible(el, rect, global.getComputedStyle(el));
    });

    if (visibleH1s.length !== 1) {
      add('typography-hierarchy', 'high', 'typography', { reason: 'expected-one-visible-h1', visibleH1Count: visibleH1s.length });
    } else {
      const h1Size = px(global.getComputedStyle(visibleH1s[0]).fontSize);
      if (h1Size < bodyFontSize * 1.6) {
        add('typography-hierarchy', 'medium', 'typography', {
          reason: 'h1-too-close-to-body-size',
          h1FontSize: h1Size,
          bodyFontSize,
          ratio: Math.round((h1Size / bodyFontSize) * 100) / 100,
        });
      }
    }

    const sections = [...document.querySelectorAll('[data-audit-section]')]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = global.getComputedStyle(el);
        if (!visible(el, rect, style)) return null;
        return Math.round(((px(style.paddingTop) + px(style.paddingBottom)) / 2) / 4) * 4;
      })
      .filter((v) => v !== null);
    const sectionValues = [...new Set(sections)];
    if (sections.length >= 3 && sectionValues.length >= 3 && Math.max(...sectionValues) - Math.min(...sectionValues) >= 24) {
      add('spacing-inconsistency', 'medium', 'spacing', { verticalSectionSpacing: sectionValues.sort((a, b) => a - b) });
    }

    const primaryCta = document.querySelector('[data-primary-cta]');
    let primaryCtaAboveFold = false;
    if (!primaryCta) {
      add('missing-primary-cta', 'high', 'conversion');
    } else {
      const rect = primaryCta.getBoundingClientRect();
      const style = global.getComputedStyle(primaryCta);
      const isVisible = visible(primaryCta, rect, style);
      primaryCtaAboveFold = isVisible && rect.top >= 0 && rect.top < viewportHeight * 0.9;
      if (!primaryCtaAboveFold) {
        add('primary-cta-not-visible-above-fold', 'high', 'conversion', {
          selector: selectorFor(primaryCta),
          top: Math.round(rect.top),
          viewportHeight,
        });
      }
    }

    let contrastFindingCount = 0;
    const textCandidates = document.querySelectorAll('h1,h2,h3,p,li,a,button,[data-audit-text]');
    for (const el of textCandidates) {
      if (contrastFindingCount >= MAX_TEXT_FINDINGS) break;
      if (!String(el.textContent || '').trim()) continue;
      const rect = el.getBoundingClientRect();
      const style = global.getComputedStyle(el);
      if (!visible(el, rect, style)) continue;
      const fg = parseColor(style.color);
      const bg = backgroundFor(el);
      const ratio = contrastRatio(fg, bg);
      if (!ratio) continue;
      const fontSize = px(style.fontSize);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const largeText = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
      const minimum = largeText ? 3 : 4.5;
      if (ratio + 0.01 < minimum) {
        contrastFindingCount += 1;
        add('low-contrast-text', ratio < 3 ? 'high' : 'medium', 'contrast', {
          selector: selectorFor(el),
          ratio: Math.round(ratio * 100) / 100,
          minimum,
        });
      }
    }

    for (const el of document.querySelectorAll('p,[data-audit-copy]')) {
      const text = String(el.textContent || '').trim();
      if (text.length < 80) continue;
      const rect = el.getBoundingClientRect();
      const style = global.getComputedStyle(el);
      if (!visible(el, rect, style)) continue;
      const fontSize = px(style.fontSize) || bodyFontSize;
      const widthInEm = rect.width / fontSize;
      if (widthInEm > 40) {
        add('excessive-text-width', 'medium', 'typography', {
          selector: selectorFor(el),
          width: Math.round(rect.width),
          fontSize,
          widthInEm: Math.round(widthInEm * 10) / 10,
        });
      }
    }

    for (const img of document.querySelectorAll('img')) {
      const rect = img.getBoundingClientRect();
      const style = global.getComputedStyle(img);
      if (!visible(img, rect, style) || !img.naturalWidth || !img.naturalHeight) continue;
      if (['cover', 'contain', 'scale-down'].includes(style.objectFit)) continue;
      const naturalRatio = img.naturalWidth / img.naturalHeight;
      const renderedRatio = rect.width / rect.height;
      const distortion = Math.abs(renderedRatio / naturalRatio - 1);
      if (distortion > 0.12) {
        add('distorted-image', 'medium', 'images', {
          selector: selectorFor(img),
          naturalRatio: Math.round(naturalRatio * 100) / 100,
          renderedRatio: Math.round(renderedRatio * 100) / 100,
          distortionPercent: Math.round(distortion * 100),
        });
      }
    }

    const buttons = [...document.querySelectorAll('button,[data-button]')]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = global.getComputedStyle(el);
        if (!visible(el, rect, style)) return null;
        return Math.round(px(style.borderTopLeftRadius) / 4) * 4;
      })
      .filter((v) => v !== null);
    const radii = [...new Set(buttons)];
    if (buttons.length >= 3 && radii.length > 2) {
      add('inconsistent-button-radius', 'low', 'consistency', { radii: radii.sort((a, b) => a - b) });
    }

    for (const group of document.querySelectorAll('[data-audit-align-group]')) {
      const lefts = [...group.children]
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const style = global.getComputedStyle(el);
          return visible(el, rect, style) ? rect.left : null;
        })
        .filter((v) => v !== null);
      if (lefts.length >= 3 && Math.max(...lefts) - Math.min(...lefts) > 12) {
        add('inconsistent-alignment', 'medium', 'alignment', {
          selector: selectorFor(group),
          leftSpread: Math.round(Math.max(...lefts) - Math.min(...lefts)),
        });
      }
    }

    const trustSignals = [...document.querySelectorAll('[data-trust-signal]')].filter((el) => {
      const rect = el.getBoundingClientRect();
      return visible(el, rect, global.getComputedStyle(el));
    }).length;
    const conversionScore = (visibleH1s.length === 1 ? 1 : 0) + (primaryCtaAboveFold ? 1 : 0) + (trustSignals > 0 ? 1 : 0);
    if (conversionScore < 2) {
      add('weak-conversion-structure', 'medium', 'conversion', {
        score: conversionScore,
        maxScore: 3,
        hasSingleVisibleH1: visibleH1s.length === 1,
        primaryCtaAboveFold,
        trustSignals,
      });
    }

    const severityWeight = { high: 14, medium: 7, low: 3 };
    const deduction = findings.reduce((sum, finding) => sum + (severityWeight[finding.severity] || 0), 0);
    const score = Math.max(0, 100 - deduction);

    return {
      skill: 'visual_site_auditor_v1',
      viewportWidth,
      viewportHeight,
      findingsCount: findings.length,
      score,
      conversion: {
        score: conversionScore,
        maxScore: 3,
        primaryCtaAboveFold,
        trustSignals,
      },
      findings,
    };
  }

  global.KhasroyVisualAudit = audit;
})(window);
