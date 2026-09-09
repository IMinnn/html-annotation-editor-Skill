#!/usr/bin/env python3
"""Embed the offline editor in UTF-8 HTML without serializing a live DOM."""
import argparse
import base64
import json
import html
import re
from pathlib import Path

BEGIN = '<!-- HTML-ANNOTATION-EDITOR:BEGIN -->'
END = '<!-- HTML-ANNOTATION-EDITOR:END -->'
LIST_HEADERS = ['编号', '菜单路径', '目标区域', '注记类型', '注记内容']


def read_list(text, mapping=None):
    """Read the skill's standardized Markdown table; never infer missing business text."""
    lines = [line.strip() for line in text.splitlines() if line.strip().startswith('|')]
    def cells(line):
        return [html.unescape(value.strip().replace('<br>', '\n')) for value in line.strip('|').split('|')]
    if len(lines) < 2 or cells(lines[0]) != LIST_HEADERS:
        raise ValueError('注记清单表头必须符合标准格式')
    if len(cells(lines[1])) != len(LIST_HEADERS) or any(not re.fullmatch(r':?-{3,}:?', v) for v in cells(lines[1])):
        raise ValueError('注记清单缺少合法表头分隔行')
    rows = [cells(line) for line in lines[2:]]
    if not rows:
        if mapping and mapping.get('notes'):
            raise ValueError('清单与内部定位数据条数不一致')
        return validate(dict(version=1, notes=[], menus=[]))
    if not isinstance(mapping, dict) or not isinstance(mapping.get('notes'), list) or len(mapping['notes']) != len(rows):
        raise ValueError('五列清单需要配套内部定位 JSON（--mapping）；由技能根据原型自动生成，不在清单中增加技术列')
    notes = []
    for i, row in enumerate(rows):
        if len(row) != len(LIST_HEADERS):
            raise ValueError('清单列数不一致；正文中的竖线需写为 &#124;')
        number, menu, area, kind, body = row
        if number != str(i+1):
            raise ValueError('清单编号必须从 1 开始连续排列')
        target = mapping['notes'][i]
        if not isinstance(target, dict) or target.get('menuPath') != menu or target.get('targetArea') != area:
            raise ValueError(f'第 {number} 条与内部定位数据的菜单路径或目标区域不一致，请重新解析定位')
        note = dict(target, menuPath=menu, targetArea=area, type=kind, body=body)
        notes.append(note)
    return validate(dict(version=1, notes=notes, menus=mapping.get('menus', [])))


def validate(data):
    if not isinstance(data, dict) or data.get('version') != 1:
        raise ValueError('数据必须是 version: 1 的对象')
    notes = data.get('notes')
    if not isinstance(notes, list):
        raise ValueError('notes 必须是数组')
    ids = set()
    for i, note in enumerate(notes):
        if not isinstance(note, dict):
            raise ValueError('每条标注必须是对象')
        for key in ('id', 'body', 'selector'):
            if not isinstance(note.get(key), str) or not note[key].strip():
                raise ValueError(f'第 {i+1} 条的 {key} 必须是非空字符串')
        if note['id'] in ids:
            raise ValueError('标注 id 不能重复')
        ids.add(note['id'])
        if 'type' in note and note['type'] not in ('字段说明', '交互逻辑', '业务规则', '修改原型'):
            raise ValueError('type 必须是字段说明、交互逻辑、业务规则或修改原型')
        if not isinstance(note.get('context', ''), str):
            raise ValueError('context 必须是字符串')
        for key in ('targetArea', 'menuPath', 'source', 'confirmationStatus'):
            if key in note and not isinstance(note[key], str):
                raise ValueError(f'{key} 必须是字符串')
        if 'pageId' in note and (not isinstance(note['pageId'], str) or not note['pageId'].strip()):
            raise ValueError('pageId 必须是非空字符串')
        if 'fingerprint' in note and (not isinstance(note['fingerprint'], dict) or
                any(not isinstance(v, str) for v in note['fingerprint'].values())):
            raise ValueError('fingerprint 必须是字符串值对象')
    menus = data.get('menus', [])
    if not isinstance(menus, list):
        raise ValueError('menus 必须是数组')
    menu_map = {}
    for menu in menus:
        if not isinstance(menu, dict) or any(not isinstance(menu.get(k), str) or not menu[k].strip() for k in ('id', 'label')):
            raise ValueError('菜单 id 与 label 必须是非空字符串')
        if menu['id'] in menu_map or menu['id'].startswith('hae:'):
            raise ValueError('菜单 id 不能重复或使用 hae: 前缀')
        for key in ('selector', 'context', 'parentId'):
            if key in menu and menu[key] is not None and not isinstance(menu[key], str):
                raise ValueError(f'菜单 {key} 必须是字符串')
        menu_map[menu['id']] = menu
    for menu in menus:
        seen = set()
        current = menu
        while current:
            if current['id'] in seen:
                raise ValueError('菜单不能循环嵌套')
            seen.add(current['id'])
            parent = current.get('parentId')
            if parent and parent not in menu_map:
                raise ValueError('菜单 parentId 必须引用已有菜单')
            current = menu_map.get(parent)
    return data


def clean_source(source):
    if BEGIN in source:
        match = re.search(re.escape(BEGIN) + r'\s*<script id="hae-data" type="application/json">([\s\S]*?)</script>', source)
        if not match:
            raise ValueError('现有编辑器数据损坏，停止写入')
        return base64.b64decode(json.loads(match[1])['base']).decode('utf-8')
    if 'axhub-annotation-host' in source or 'AxhubAnnotation.createAnnotationViewer' in source:
        raise ValueError('检测到旧 Axhub 运行时：先迁移数据并在副本中移除旧接入块，避免双重标记')
    return source


def build(source, data, runtime):
    source = clean_source(source)
    payload = dict(validate(data), base=base64.b64encode(source.encode()).decode())
    serialized = json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c')
    if re.search(r'</script', runtime, re.I):
        raise ValueError('运行时代码含原始 script 结束标记')
    block = f'{BEGIN}\n<script id="hae-data" type="application/json">{serialized}</script>\n<script id="hae-runtime">{runtime}</script>\n{END}\n'
    # Insert before the final body close; otherwise append at EOF.
    matches = list(re.finditer(r'</body\s*>', source, re.I))
    at = matches[-1].start() if matches else len(source)
    return source[:at] + block + source[at:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('html', type=Path)
    parser.add_argument('data', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--mapping', type=Path, help='技能自动生成的内部定位 JSON，配合五列 Markdown 清单使用')
    args = parser.parse_args()
    if args.html.resolve() == args.output.resolve():
        parser.error('请输出到新文件，保留原 HTML')
    if args.output.exists():
        parser.error('输出文件已存在，请使用新文件名')
    runtime = (Path(__file__).resolve().parents[1] / 'assets/editor.js').read_text()
    text = args.data.read_text(encoding='utf-8')
    mapping = json.loads(args.mapping.read_text(encoding='utf-8')) if args.mapping else None
    data = read_list(text, mapping) if args.data.suffix.lower() == '.md' else json.loads(text)
    result = build(args.html.read_text(encoding='utf-8'), data, runtime)
    args.output.write_text(result, encoding='utf-8')
    print(args.output.resolve())


if __name__ == '__main__':
    main()
