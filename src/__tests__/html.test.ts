import { describe, expect, test } from 'bun:test';
import {
  decodeHtmlEntities,
  htmlToMarkdown,
  htmlToText,
  looksLikeEscapedHtml,
  looksLikeHtml,
} from '../utils/html.ts';

describe('decodeHtmlEntities', () => {
  test('named + numeric entities', () => {
    expect(
      decodeHtmlEntities(
        'R&amp;D &lt;3 &quot;hi&quot; &#39;x&#39; &#x2014; &rsquo;'
      )
    ).toBe(`R&D <3 "hi" 'x' — ’`);
    expect(decodeHtmlEntities('a&nbsp;b &unknown; &#xZZ;')).toBe(
      'a b &unknown; &#xZZ;'
    );
    expect(decodeHtmlEntities('a &amp; b &lt;c&gt; &#39;d&#x27; &nbsp;')).toBe(
      "a & b <c> 'd'  "
    );
    expect(decodeHtmlEntities('&unknown; &#0;')).toBe('&unknown; &#0;');
  });
});

describe('htmlToText', () => {
  test('renders blocks, lists, and links as plain text', () => {
    const html =
      '<b>Join Google Meet:</b> <a href="https://meet.google.com/x">https://meet.google.com/x</a><br/><br/>' +
      '<p>Hi <span>Chris</span>, </p><p></p><p><strong>Agenda:</strong></p>' +
      '<ul><li><p>1:30 PM - 2:00 PM (PDT) - Recruiting Intro Chat</p>' +
      '<ul><li><p>Ian Lynch (Sourcer, <a href="https://linkedin.com">LinkedIn</a>)</p></li></ul></li></ul>';

    expect(htmlToText(html)).toBe(
      [
        'Join Google Meet: https://meet.google.com/x',
        '',
        'Hi Chris,',
        '',
        'Agenda:',
        '',
        '- 1:30 PM - 2:00 PM (PDT) - Recruiting Intro Chat',
        '  - Ian Lynch (Sourcer, LinkedIn)',
      ].join('\n')
    );
  });

  test('nests ul/ol with indentation', () => {
    expect(
      htmlToText(`
        <ol>
          <li>First
            <ul><li>a</li><li>b<ol><li>deep</li></ol></li></ul>
          </li>
          <li>Second</li>
        </ol>
        <ul><li>x<li>y</ul>
      `)
    ).toBe(
      [
        '1. First',
        '   - a',
        '   - b',
        '     1. deep',
        '2. Second',
        '',
        '- x',
        '- y',
      ].join('\n')
    );
  });

  test('list items with <br>, <p>, and <div> stay under their bullet', () => {
    expect(
      htmlToText(
        '<ul>' +
          '<li>Line one<br>line two</li>' +
          '<li><p>Para one</p><p>Para two</p></li>' +
          '<li><div>Div one</div><div>Div two</div></li>' +
          '<li><p></p></li>' +
          '</ul>'
      )
    ).toBe(
      [
        '- Line one',
        '  line two',
        '- Para one',
        '  Para two',
        '- Div one',
        '  Div two',
      ].join('\n')
    );
  });

  test('drops markdown syntax: emphasis, code, headings, quotes, rules', () => {
    expect(
      htmlToText(
        '<h2>Title</h2><p><em>a</em> <code>b</code> <a href="https://x.io">c</a></p>' +
          '<blockquote>quoted</blockquote><hr><pre>  pre\n  text</pre>'
      )
    ).toBe('Title\n\na b c\n\nquoted\n\n  pre\n  text');
  });

  test("Google Calendar's description HTML", () => {
    const html =
      '<html-blob><u></u>Looking forward to it!<br><br>' +
      '<b>Agenda</b><br>1. Intros<br>2. Coding<br><br>' +
      'Join with Google Meet: <a href="https://meet.google.com/abc-defg-hij">meet.google.com/abc-defg-hij</a>' +
      '<br>Join by phone<br>(US) +1 555-0100 PIN: 123&nbsp;456#<u></u></html-blob>';

    expect(htmlToText(html)).toBe(
      [
        'Looking forward to it!',
        '',
        'Agenda',
        '1. Intros',
        '2. Coding',
        '',
        'Join with Google Meet: meet.google.com/abc-defg-hij',
        'Join by phone',
        '(US) +1 555-0100 PIN: 123 456#',
      ].join('\n')
    );
  });

  test('a recruiting schedule (nested lists inside <p>s, links, <br>s)', () => {
    const html = `
<p>Hi <span>Ada</span>,</p>
<p></p>
<p>Please find your interview schedule below.</p>
<ul>
  <li>
    <p>2:00 PM - 3:00 PM (PDT) - Technical Screen - Front End</p>
    <ul>
      <li><p>Jane Roe (Senior Software Engineer)</p></li>
      <li><p>Sam Poe (Software Engineer II)</p></li>
    </ul>
  </li>
  <li><p>----- 30m Break -----</p></li>
  <li>
    <p>3:30 PM - 4:15 PM (PDT) - Hiring Manager Interview</p>
    <ul>
      <li><p>Pat Doe (Senior Engineering Manager)</p></li>
    </ul>
  </li>
</ul>
<br />&nbsp;
<p>
  If you have any questions, please
  reach out!
</p>
<br />&nbsp;
<p>Best,</p>
<p><span>Riley Coordinator</span></p>
<p>
  2:00 PM - 3:00 PM (PDT): Coding Link: <a href="https://example.com/x"
    >https://example.com/x</a
  ><br />
</p>
<br />
<p>
  <a href="https://example.com/opt-out" target="_blank"
    >Click here to opt-out</a
  >
</p>`;

    expect(htmlToText(html)).toBe(
      [
        'Hi Ada,',
        '',
        'Please find your interview schedule below.',
        '',
        '- 2:00 PM - 3:00 PM (PDT) - Technical Screen - Front End',
        '  - Jane Roe (Senior Software Engineer)',
        '  - Sam Poe (Software Engineer II)',
        '- ----- 30m Break -----',
        '- 3:30 PM - 4:15 PM (PDT) - Hiring Manager Interview',
        '  - Pat Doe (Senior Engineering Manager)',
        '',
        'If you have any questions, please reach out!',
        '',
        'Best,',
        '',
        'Riley Coordinator',
        '',
        '2:00 PM - 3:00 PM (PDT): Coding Link: https://example.com/x',
        '',
        'Click here to opt-out',
      ].join('\n')
    );
  });

  test('keeps lists and line breaks inside layout tables and wrappers', () => {
    const html =
      '<center><table><tbody><tr><td><section><span><ul>' +
      '<li>2:00 PM - 3:00 PM (PDT) - Coding<ul><li>Jane Roe (Engineer)</li></ul></li>' +
      '<li>3:00 PM - 4:00 PM (PDT) - Design</li>' +
      '</ul></span></section></td></tr>' +
      '<tr><td>Line one<br>line two</td></tr>' +
      '<tr><td>Name</td><td>Role</td></tr></tbody></table></center>';

    expect(htmlToText(html)).toBe(
      [
        '- 2:00 PM - 3:00 PM (PDT) - Coding',
        '  - Jane Roe (Engineer)',
        '- 3:00 PM - 4:00 PM (PDT) - Design',
        '',
        'Line one',
        'line two',
        '',
        'Name · Role',
      ].join('\n')
    );
  });

  test('keeps <br>s inside <pre>', () => {
    expect(htmlToText('<pre>Coding<br>System Design</pre>')).toBe(
      'Coding\nSystem Design'
    );
    expect(htmlToMarkdown('<pre>a<br/>b</pre>')).toBe('```\na\nb\n```');
  });

  test('plain text only gets its whitespace tidied', () => {
    expect(htmlToText('Attendee:\r\nChris  (a < b)\r\n\r\n\r\n\r\nEvent')).toBe(
      'Attendee:\nChris (a < b)\n\nEvent'
    );
    // (zero-width preheader padding)
    expect(htmlToText('Portal‌ ͏﻿\n\nThanks')).toBe('Portal\n\nThanks');
  });

  test('<div> lines (Gmail / Google Calendar) are lines, not paragraphs', () => {
    const html =
      '<div><strong>Monday, September 28, 2026:</strong></div>' +
      '<div>10:00am - 11:00am PT - Technical Interview with Alex Example</div>' +
      '<div>11:00am - 11:30am PT - Break</div>' +
      '<div><br></div>' +
      '<div><a href="https://zoom.example.com/j/1">Zoom link</a> </div>' +
      '<div>Meeting ID: 123 456 </div>' +
      '<div></div>' +
      '<div><br></div><div><br></div>' +
      '<div dir="ltr">Warm regards,<div>Sam</div></div>';

    expect(htmlToText(html)).toBe(
      [
        'Monday, September 28, 2026:',
        '10:00am - 11:00am PT - Technical Interview with Alex Example',
        '11:00am - 11:30am PT - Break',
        '',
        'Zoom link',
        'Meeting ID: 123 456',
        '',
        'Warm regards,',
        'Sam',
      ].join('\n')
    );
    expect(htmlToMarkdown(html)).toContain(
      '**Monday, September 28, 2026:**\n10:00am'
    );
  });

  test('drops hidden preheaders and invisible padding characters', () => {
    const html =
      '<html><head><style>.x { color: red }</style></head><body>' +
      '<div style="display:none;max-height:0;overflow:hidden">' +
      'Your interview is confirmed&zwnj;&#847; &zwnj;&#847; &zwnj;&#847;</div>' +
      '<span hidden>hidden text</span>' +
      '<table role="presentation"><tr><td>' +
      '<p>Hi Sam,</p><p>Your interview is confirmed.&#8203;</p>' +
      '<p>&zwnj;&#847; &zwnj;&#847; &#173;</p>' +
      '</td></tr></table>' +
      // `display` inside another property isn't hiding anything
      '<p style="mso-display: none-ish; color: red">Visible</p>' +
      '</body></html>';

    expect(htmlToText(html)).toBe(
      'Hi Sam,\n\nYour interview is confirmed.\n\nVisible'
    );
  });

  test('hidden elements with omitted end tags keep their visible siblings', () => {
    expect(
      htmlToText('<p hidden>Preview<div>Visible job requirements</div>')
    ).toBe('Visible job requirements');
    expect(htmlToText('<table><tr><td hidden>Preview<td>Visible</table>')).toBe(
      'Visible'
    );
    expect(
      htmlToText(
        '<table><tr><td>a<tr style="display:none"><td>Preview<tr><td>b</table>'
      )
    ).toBe('a\n\nb');
    expect(htmlToText('<ul><li hidden>Preview<li>Item</ul>')).toBe('- Item');
    expect(htmlToText('<dl><dt hidden>Preview<dd>Term</dl>')).toBe('Term');
    // a <div> inside a table cell doesn't close a <p> around the table
    expect(
      htmlToMarkdown('<p>Intro<table><tr><td>x<div>y</div></td></tr></table>')
    ).toBe('Intro\n\nx\ny');
  });

  test('the effective display wins (last declaration, !important first)', () => {
    expect(htmlToText('<p style="display:none;display:block">Shown</p>')).toBe(
      'Shown'
    );
    expect(
      htmlToText('<p style="display: none !important; display: block">x</p>')
    ).toBe('');
    expect(
      htmlToText('<p style="display:block;display:none">Hidden</p><p>y</p>')
    ).toBe('y');
  });

  test('a scheduling email: layout tables, quoted reply, footer', () => {
    const html =
      '<div dir="ltr"><div>Hi Sam,</div><div><br></div>' +
      '<div>Please find the updated schedule below.</div></div><br>' +
      '<div class="gmail_quote"><div dir="ltr" class="gmail_attr">' +
      'On Mon, Sep 28, 2026 at 3:21 PM Recruiting &lt;' +
      '<a href="mailto:recruiting@example.com">recruiting@example.com</a>&gt; wrote:<br></div>' +
      '<blockquote class="gmail_quote"><table width="100%"><tbody><tr><td>' +
      '<table><tr><td><b>Schedule</b></td></tr>' +
      '<tr><td>8:45AM (PDT) - 9:30AM (PDT): Pat Example (Engineering Manager) - Technical Depth<br>' +
      '---------- 30m Break ----------<br>' +
      '10:00AM (PDT) - 11:00AM (PDT): Lee Sample (Staff Software Engineer) - Coding</td></tr>' +
      '</table></td></tr>' +
      '<tr><td style="font-size:11px">Unsubscribe &middot; Help</td></tr>' +
      '</tbody></table></blockquote></div>';

    expect(htmlToText(html)).toBe(
      [
        'Hi Sam,',
        '',
        'Please find the updated schedule below.',
        '',
        'On Mon, Sep 28, 2026 at 3:21 PM Recruiting <recruiting@example.com> wrote:',
        '',
        'Schedule',
        '',
        '8:45AM (PDT) - 9:30AM (PDT): Pat Example (Engineering Manager) - Technical Depth',
        '---------- 30m Break ----------',
        '10:00AM (PDT) - 11:00AM (PDT): Lee Sample (Staff Software Engineer) - Coding',
        '',
        'Unsubscribe · Help',
      ].join('\n')
    );
    // no markdown escapes or leftover tags/entities
    expect(htmlToMarkdown(html)).not.toMatch(/\\[-*.#_]|<\/?[a-z]|&[a-z]+;/);
  });
});

describe('looksLikeHtml', () => {
  test('detects raw vs escaped html', () => {
    expect(looksLikeHtml('<p>Hi</p>')).toBe(true);
    expect(looksLikeHtml('<br/>')).toBe(true);
    expect(looksLikeHtml('1 < 2 and 3 > 2')).toBe(false);
    expect(looksLikeEscapedHtml('&lt;div class=&quot;x&quot;&gt;')).toBe(true);
    expect(looksLikeEscapedHtml('1 &lt; 2')).toBe(false);
  });
});

describe('htmlToMarkdown', () => {
  test('headings, paragraphs, and inline formatting', () => {
    expect(
      htmlToMarkdown(`
        <h1>Senior <em>Engineer</em></h1>
        <p>We <strong>ship</strong> <i>fast</i>, with <code>bun test</code>.</p>
        <p>See <a href="https://example.com/jobs">our jobs </a>page.</p>
        <h3><strong>About you</strong></h3>
        <div>Line one<br>Line two<br><br>New paragraph</div>
      `)
    ).toBe(
      [
        '# Senior Engineer',
        'We **ship** *fast*, with `bun test`.',
        'See [our jobs](https://example.com/jobs) page.',
        '### About you',
        'Line one\nLine two',
        'New paragraph',
      ].join('\n\n')
    );
  });

  test('moves whitespace outside of emphasis and drops empty emphasis', () => {
    expect(
      htmlToMarkdown('<p><strong>Experience: </strong>5+ years<b> </b></p>')
    ).toBe('**Experience:** 5+ years');
    expect(htmlToMarkdown('<b><strong>Both</strong></b>')).toBe('**Both**');
  });

  test('nested + ordered lists', () => {
    expect(
      htmlToMarkdown(`
        <ul>
          <li>One</li>
          <li><p>Two</p>
            <ol start="3"><li>Three</li><li>Four<ul><li>Five</li></ul></li></ol>
          </li>
          <li></li>
        </ul>
      `)
    ).toBe(
      ['- One', '- Two', '  3. Three', '  4. Four', '     - Five'].join('\n')
    );
  });

  test('unclosed and orphaned list items', () => {
    expect(htmlToMarkdown('<ul><li>a<li>b</ul>')).toBe('- a\n- b');
    // e.g. Lever's `<div><li>…</li></div>`
    expect(htmlToMarkdown('<div>\n\n<li>a</li>\n<li>b</li></div>')).toBe(
      '- a\n- b'
    );
  });

  test('blockquotes, code blocks, rules, and tables', () => {
    expect(
      htmlToMarkdown(`
        <blockquote><p>Quote</p><p>More</p></blockquote>
        <pre><code>const a = 1;
  indented();</code></pre>
        <hr>
        <table><tr><th>Level</th><th>Pay</th></tr><tr><td>L5</td><td>$1</td></tr></table>
      `)
    ).toBe(
      [
        '> Quote\n>\n> More',
        '```\nconst a = 1;\n  indented();\n```',
        '---',
        'Level · Pay',
        'L5 · $1',
      ].join('\n\n')
    );
  });

  test('drops scripts, styles, images, comments, and unsafe links', () => {
    expect(
      htmlToMarkdown(`
        <!-- comment --><style>p { color: red }</style>
        <script>alert("<p>no</p>")</script>
        <meta name="x" content="y"><img src="x.png" alt="logo">
        <p><a href="javascript:alert(1)">Click</a> <a href="/relative">here</a></p>
        <p><span style="font-weight: 400">Plain&nbsp;span</span></p>
      `)
    ).toBe('Click here\n\nPlain span');
  });

  test('block elements nested in inline ones', () => {
    expect(
      htmlToMarkdown('<span><div>First</div><div>Second</div></span>')
    ).toBe('First\nSecond');
  });

  test('decodes entities in text and attributes', () => {
    expect(
      htmlToMarkdown(
        '<p>R&amp;D &mdash; <a href="https://x.com/?a=1&amp;b=2">link</a></p>'
      )
    ).toBe('R&D — [link](https://x.com/?a=1&b=2)');
  });
});

test('HTML links cannot inject additional Markdown links through label brackets', () => {
  const html =
    '<a href="https://example.com">x](javascript:alert(1))</a><a href="data:text/plain,evil">safe</a>';
  const markdown = htmlToMarkdown(html);
  expect(markdown).toContain('x\\](javascript:alert(1))');
  expect(markdown).not.toContain('(data:');
});

test('HTML preformatted content cannot close its generated fence', () => {
  expect(htmlToMarkdown('<pre>```\n~~~\ncode</pre>')).toBe(
    '````\n```\n~~~\ncode\n````'
  );
});
