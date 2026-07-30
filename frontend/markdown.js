/* Minimal markdown renderer for Lune replies. Escapes HTML first. */
(function () {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inline(text) {
    return text
      .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function renderTable(rows) {
    const cells = rows.map((row) =>
      row
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim())
    );

    const isDivider = (row) => /^\s*\|?[\s:|-]+\|?\s*$/.test(row) && row.includes("-");
    let header = null;
    let body = cells;

    if (rows.length > 1 && isDivider(rows[1])) {
      header = cells[0];
      body = cells.slice(2);
    }

    let html = '<table class="md-table">';
    if (header) {
      html += "<thead><tr>" + header.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead>";
    }
    html += "<tbody>";
    for (const row of body) {
      html += "<tr>" + row.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
    }
    return html + "</tbody></table>";
  }

  function render(markdown) {
    const source = escapeHtml(markdown || "");
    const lines = source.split("\n");
    const out = [];

    let listType = null;
    let inCode = false;
    let codeLines = [];
    let tableRows = [];

    function closeList() {
      if (listType) {
        out.push(`</${listType}>`);
        listType = null;
      }
    }

    function closeTable() {
      if (tableRows.length) {
        out.push(renderTable(tableRows));
        tableRows = [];
      }
    }

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (inCode) {
          out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
          codeLines = [];
          inCode = false;
        } else {
          closeList();
          closeTable();
          inCode = true;
        }
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        continue;
      }

      if (line.trim().startsWith("|") && line.includes("|")) {
        closeList();
        tableRows.push(line.trim());
        continue;
      }
      closeTable();

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        closeList();
        const level = Math.min(heading[1].length + 1, 5);
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        continue;
      }

      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
        closeList();
        out.push("<hr>");
        continue;
      }

      const quote = line.match(/^&gt;\s?(.*)$/);
      if (quote) {
        closeList();
        out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
        continue;
      }

      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      if (bullet) {
        if (listType !== "ul") {
          closeList();
          out.push("<ul>");
          listType = "ul";
        }
        out.push(`<li>${inline(bullet[1])}</li>`);
        continue;
      }

      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (numbered) {
        if (listType !== "ol") {
          closeList();
          out.push("<ol>");
          listType = "ol";
        }
        out.push(`<li>${inline(numbered[1])}</li>`);
        continue;
      }

      if (!line.trim()) {
        closeList();
        continue;
      }

      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }

    if (inCode && codeLines.length) {
      out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
    }
    closeList();
    closeTable();

    return out.join("\n");
  }

  window.LuneMarkdown = { render: render, escapeHtml: escapeHtml };
})();
