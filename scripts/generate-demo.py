"""Generate only fictional demo data and locally drawn app icons; no dependencies."""
import json
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]


def make_pdf():
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    pages = []
    for number in range(1, 13):
        page_id = len(objects) + 1
        stream_id = page_id + 1
        pages.append(f"{page_id} 0 R")
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {stream_id} 0 R >>".encode())
        commands = [
            "0.086 0.306 0.322 rg 0 690 612 102 re f",
            "1 1 1 rg BT /F1 24 Tf 40 742 Td (PAPER READER - FICTIONAL DEMO) Tj ET",
            f"0.086 0.306 0.322 rg BT /F1 100 Tf 220 525 Td ({number:02}) Tj ET",
            f"BT /F1 20 Tf 234 480 Td (Page {number} / 12) Tj ET",
            "BT /F1 14 Tf 40 420 Td (This is synthetic material for testing the reader.) Tj ET",
        ]
        for row in range(16):
            commands.append(f"BT /F1 12 Tf 40 {380 - row * 18} Td (Sample line {row + 1:02}: Scroll, pinch, and restore this page.) Tj ET")
        commands.append(f"BT /F1 10 Tf 40 35 Td (Fictional demo only - page {number}) Tj ET")
        stream = "\n".join(commands).encode()
        objects.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
    objects[1] = f"<< /Type /Pages /Count 12 /Kids [{' '.join(pages)}] >>".encode()
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        output.extend(f"{offset:010} 00000 n \n".encode())
    output.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return output


def make_icon(size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            u, v = x * 192 / size, y * 192 / size
            paper = 46 <= v < 146 and (42 <= u < 90 or 102 <= u < 150)
            line = any(abs(v - line_y) < 3 for line_y in (65, 81, 97, 113)) and (52 <= u < 80 or 112 <= u < 140)
            raw.extend((255, 255, 255) if paper and not line else (22, 78, 82))

    def chunk(name, data):
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data) & 0xffffffff)

    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def make_figure(index, width, height):
    colors = [(42, 125, 145), (211, 126, 54), (104, 90, 173), (57, 147, 101)]
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            u, v = x / width, y / height
            if index == 0:
                shape = any((u - cx) ** 2 + (v - cy) ** 2 < .018 for cx, cy in [(0.25, 0.3), (0.7, 0.3), (0.5, 0.72)])
                line = abs(v - .3) < .015 and .25 < u < .7
            elif index == 1:
                shape = .2 < u < .8 and any(lo < v < lo + .14 for lo in [.12, .42, .72])
                line = abs(u - .5) < .015 and .2 < v < .85
            elif index == 2:
                shape = any(lo < u < lo + .12 and top < v < .85 for lo, top in [(.12, .6), (.34, .42), (.56, .23), (.78, .1)])
                line = abs(v - .87) < .01 or abs(u - .08) < .01
            else:
                shape = abs(v - (.75 - .5 * u)) < .04 and .1 < u < .9
                line = any(abs(u - p) < .004 or abs(v - p) < .004 for p in [.2, .4, .6, .8])
            raw.extend(colors[index] if shape else (185, 197, 201) if line else (250, 251, 252))

    def chunk(name, data):
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data) & 0xffffffff)

    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def main():
    demo = ROOT / 'demo'
    demo.mkdir(exist_ok=True)
    (demo / 'reader-demo.pdf').write_bytes(make_pdf())
    headings = ['新規性と貢献（一言）', 'アブストラクト', '研究背景', 'モチベーション', '目的', '関連研究', '先行研究との比較・新規性', '貢献', '技術や方法のポイント', '実験方法', '結果', '議論', '本研究の限界']
    summary = [{'heading': heading, 'text': 'これは画面確認のための架空の要約です。実在する研究や人物とは関係ありません。\n改行を保って表示することを確かめます。'} for heading in headings]
    summary[1]['text'] = '\n\n'.join(f'段落 {i}。紙の庭で光の積み木を並べる架空の実験を想定します。長い要約を右だけでスクロールしながら、左の PDF のページ位置が動かないことを確かめます。' for i in range(1, 19))
    base = dict(authors='Demo Author A; Demo Author B（架空）', year=2026, venue='Fictional Reading Workshop', type='Demo', doi='10.0000/fictional-reader-demo', tags=['架空実験', '読書UI'], importance='★★', read_status='未読', bibtex='@misc{fictional_reader_demo,\n  title = {A Fictional Reading Garden},\n  author = {Demo Author},\n  year = {2026}\n}', pdf={'name': 'reader-demo.pdf', 'drive_id': None}, summary=summary)
    papers = [
        dict(base, id='demo-read', title='A Previously Read Paper', title_jp='既読の架空論文', read_status='既読', importance='★★★★★'),
        dict(base, id='demo-long', title='B. A Fictional Reading Garden: Exploring Very Long Titles, Independent Scrolling, and Twelve Numbered Pages on a Small Screen', title_jp='架空の読書の庭で長い題と独立したスクロールを確かめる', authors='Demo Author A; Demo Author B; Demo Author C; Demo Author D; Demo Author E（全員架空）', importance='★★★★'),
        dict(base, id='demo-first', title='A. Imaginary Light Blocks', title_jp='架空の光の積み木', importance='★★★★', tags=['光の模型', '読書UI']),
        dict(base, id='demo-no-pdf', title='C. Notes Without a PDF', title_jp='PDF のない架空の記録', pdf=None, tags=['記録']),
        dict(base, id='demo-empty', title='D. An Empty Summary', title_jp='要約のない架空の論文', summary=[], tags=['空欄テスト'], authors='', year=None, venue='', type='', doi='', bibtex='', importance='★'),
        dict(base, id='demo-missing', title='E. A Missing File', title_jp='見つからない PDF の架空の例', pdf={'name': 'missing-demo.pdf', 'drive_id': None}, tags=['記録'], summary=[], importance='★'),
    ]
    added_days = [20, 24, 28, 22, 26, 18]
    comments = {
        0: '架空の実験条件を読み返した。次は図と比べたい。',
        2: '画面確認用の架空の長いコメントです。一覧は1行で省略し、コメントの編集欄で全文を読めます。\n光の積み木の配置を比べる条件をメモしました。\n次に読むときは図の色分けを確認します。\nこの4行目も編集欄に残ります。',
        4: '要約がなくてもコメントは残せる。架空のメモ。',
    }
    for index, paper in enumerate(papers):
        paper['added'] = f'2026-10-{added_days[index]:02}T12:00:00+09:00'
        paper['comment'] = comments.get(index, '')
    figures = demo / 'figures'
    figures.mkdir(exist_ok=True)
    for index, (width, height) in enumerate([(240, 180), (120, 240), (320, 100), (240, 180)]):
        name = f'figure-{index + 1}.png'
        (figures / name).write_bytes(make_figure(index, width, height))
        papers[index]['figure'] = {'name': name, 'drive_id': f'demo:{name}'}
    papers[4]['figure'] = None
    feed_base = dict(authors='Demo Author C（架空）', venue='Fictional Morning Workshop', year=2026,
                     doi='10.0000/fictional-morning-demo', url='', oa_pdf='',
                     ja='紙の庭に浮かぶ光のしおりを比べる架空の論文です。画面確認のために作った内容です。',
                     why='毎朝 PDF を入れて要約と並べて読む流れを、架空の題材で試せます。',
                     abstract='This fictional study imagines glowing bookmarks in a paper garden. No real research or participants are described.',
                     pdf=None, skipped=False, notion_id=None)
    titles = ['今日の架空の光のしおり', '昨日の架空の紙の小道', '一昨日の架空の雲の図書館', 'PDF 入りの架空の星の頁', '見送り済みの架空の砂の本']
    titles += [f'架空の読書の庭の観察 {index}' for index in range(1, 12)]
    feed = [dict(feed_base, key=f'demo-feed-{index}', served=f'2026-10-{28-index:02}', title=title,
                 pdf_name=f'{title}.pdf') for index, title in enumerate(titles)]
    feed[0]['oa_pdf'] = './demo/reader-demo.pdf'
    feed[1]['oa_pdf'] = './demo/reader-demo.pdf'
    feed[3]['pdf'] = {'name': 'reader-demo.pdf', 'drive_id': None}
    feed[4]['skipped'] = True
    (demo / 'papers.json').write_text(json.dumps({'generated': '2026-10-24T12:00:00+09:00', 'today': 'demo-read', 'papers': papers, 'feed': feed}, ensure_ascii=False, indent=2) + '\n')
    icons = ROOT / 'icons'
    icons.mkdir(exist_ok=True)
    for size in (192, 512):
        (icons / f'icon-{size}.png').write_bytes(make_icon(size))


if __name__ == '__main__':
    main()
