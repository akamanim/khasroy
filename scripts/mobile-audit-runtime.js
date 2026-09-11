(function (global) {
  function visible(rect, style) {
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function audit(options = {}) {
    const viewportWidth = options.viewportWidth || document.documentElement.clientWidth || global.innerWidth;
    const targetMinimum = options.targetMinimum || 24;
    const findings = [];
    const doc = document.documentElement;

    if (doc.scrollWidth > viewportWidth + 1) {
      findings.push({
        type: 'document-horizontal-overflow',
        viewportWidth,
        scrollWidth: doc.scrollWidth,
        overflowBy: doc.scrollWidth - viewportWidth,
      });
    }

    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      const style = global.getComputedStyle(el);
      if (!visible(rect, style)) continue;
      if (rect.right > viewportWidth + 1 || rect.left < -1) {
        findings.push({
          type: 'element-horizontal-overflow',
          selector: selectorFor(el),
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          viewportWidth,
        });
      }
    }

    const pointerSelector = 'button,a[href],input,select,textarea,[role="button"]';
    for (const el of document.querySelectorAll(pointerSelector)) {
      const rect = el.getBoundingClientRect();
      const style = global.getComputedStyle(el);
      if (!visible(rect, style)) continue;
      if (rect.width < targetMinimum || rect.height < targetMinimum) {
        findings.push({
          type: 'undersized-pointer-target',
          selector: selectorFor(el),
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          minimum: targetMinimum,
        });
      }
    }

    return { viewportWidth, targetMinimum, findingsCount: findings.length, findings };
  }

  function selectorFor(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const cls = [...el.classList].slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
    return el.tagName.toLowerCase() + cls;
  }

  global.KhasroyMobileRuntimeAudit = audit;
})(window);
