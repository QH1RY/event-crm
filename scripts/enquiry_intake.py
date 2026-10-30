"""Conservative inbox-to-enquiry capture. No email sending or booking confirmation.
Default mode is read-only preview. --ingest requires the deployed enquiry API.
"""
import argparse
import datetime as dt
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

LABELS = ['EVENT DATE', 'EVENT TYPE', 'COMPANY', 'TELEPHONE', 'EXPERIENCE', 'MESSAGE', 'GUESTS', 'VENUE', 'EMAIL', 'NAME', 'PHONE']
LABEL = re.compile(r'^\s*(' + '|'.join(LABELS) + r')\s*:?\s*(.*)$', re.I)
EMAIL = re.compile(r'^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$')
BRANDS = {'info@quirky-hire.co.uk': 'Quirky Hire', 'info@photoboothslondon.co.uk': 'Photobooths London', 'ryan@bxp123.com': 'Brand Experience Partner'}

class PlainHTML(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.skip += 1
        if tag in ('br', 'p', 'div', 'li', 'tr', 'td'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.skip = max(0, self.skip - 1)
        if tag in ('p', 'div', 'li', 'tr'): self.parts.append('\n')
    def handle_data(self, text):
        if not self.skip: self.parts.append(text)

def plain(body):
    content = body.get('content', '')
    if body.get('contentType', '').lower() == 'html':
        parser = PlainHTML(); parser.feed(content); content = ''.join(parser.parts)
    return re.sub(r'\n[ \t]*\n+', '\n', content).strip()

def form_fields(text):
    fields = {}; current = None
    for line in text.splitlines():
        match = LABEL.match(line)
        if match and current != 'MESSAGE':
            current = match.group(1).upper(); fields.setdefault(current, match.group(2).strip())
        elif current and line.strip():
            fields[current] = (fields[current] + '\n' + line.strip()).strip()
    return fields

def nullable(value):
    value = (value or '').strip()
    return None if value.lower() in ('', '—', '-', 'tbc', 'unknown', 'not known', 'not provided') else value

def exact_date(value):
    try:
        return dt.date.fromisoformat(value).isoformat() if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value or '') else None
    except ValueError:
        return None

def extract_candidate(message, mailbox):
    subject = (message.get('subject') or '').strip()
    if not message.get('id') or re.match(r'^(re|fw|fwd|automatic reply|auto[ -]?reply|out of office|undeliverable|delivery (?:status|failure))\s*:', subject, re.I): return None
    text = plain(message.get('body', {})); fields = form_fields(text)
    sender = message.get('from', {}).get('emailAddress', {})
    form = bool(fields.get('EMAIL') and (fields.get('MESSAGE') or fields.get('EXPERIENCE')))
    if not form:
        if re.search(r'(unsubscribe|newsletter)', text, re.I) or re.search(r'(noreply|no-reply|newsletter)', sender.get('address', ''), re.I): return None
        if not re.search(r'(enquir|inquir|quot|hire|photo\s?booth|drap|event)', subject, re.I): return None
        if not re.search(r'(looking for|interested|require|\bneed\b|availability|how much|could you|would like)', text, re.I): return None
    contact = (fields.get('EMAIL') if form else sender.get('address', '')) or ''
    if not EMAIL.fullmatch(contact.strip()): return None
    recipients = [x.get('emailAddress', {}).get('address', '').lower() for x in message.get('toRecipients', [])]
    brand = next((BRANDS[x] for x in recipients if x in BRANDS), BRANDS.get(mailbox.lower(), 'Unassigned'))
    # Only an explicit website-form header can override the receiving mailbox's brand.
    if form and re.match(r'^photoboothslondon\.co\.uk\s', text, re.I): brand = 'Photobooths London'
    if form and re.match(r'^bxp123\.com\s', text, re.I): brand = 'Brand Experience Partner'
    guests = nullable(fields.get('GUESTS')); guests = int(guests) if guests and re.fullmatch(r'\d+', guests) else None
    name = nullable(fields.get('NAME')) if form else nullable(sender.get('name'))
    received = message.get('receivedDateTime')
    try:
        if received: received = dt.datetime.fromisoformat(received.replace('Z', '+00:00')).astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
    except ValueError: received = None
    link = message.get('webLink')
    if link and not link.startswith(('https://', 'http://')): link = None
    return {'client_name': (name or contact)[:200], 'company': nullable(fields.get('COMPANY')),
            'brand': brand, 'service': nullable(fields.get('EXPERIENCE')),
            'event_name': (nullable(fields.get('EVENT TYPE')) or subject)[:200],
            'contact_email': contact.strip(), 'contact_phone': nullable(fields.get('TELEPHONE') or fields.get('PHONE')),
            'event_date': exact_date(fields.get('EVENT DATE')), 'venue': nullable(fields.get('VENUE')),
            'guest_count': guests, 'brief': (fields.get('MESSAGE') or text)[:5000],
            'status': 'New enquiry', 'priority': 'normal', 'owner': 'Ryan',
            'next_action': 'Review enquiry and prepare a response. No reply has been sent.',
            'next_action_due': None, 'last_contact_at': received, 'source_url': link,
            'source_mailbox': mailbox, 'source_conversation_id': message.get('conversationId'),
            'source_message_id': message['id']}

def powershell(connector, args):
    result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(connector), *args], capture_output=True, encoding='utf-8', errors='replace', timeout=150)
    if result.returncode:
        # The connector sanitises errors and never writes headers or credentials.
        raise RuntimeError((result.stderr or result.stdout)[-1500:])

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ingest', action='store_true', help='Explicitly enable writes to the deployed controlled enquiry API')
    parser.add_argument('--since', help='Explicit ISO UTC lower bound; default preview is the last 24h, first ingest starts now')
    parser.add_argument('--state-dir', type=Path, default=Path(__file__).resolve().parent / 'state')
    args = parser.parse_args(); args.state_dir.mkdir(parents=True, exist_ok=True)
    checkpoint = args.state_dir / 'checkpoint.json'
    now = dt.datetime.now(dt.timezone.utc); end = now.isoformat().replace('+00:00', 'Z')
    if args.since:
        since = args.since
    elif checkpoint.exists():
        since = json.loads(checkpoint.read_text(encoding='utf-8'))['until']
    elif args.ingest:
        checkpoint.write_text(json.dumps({'until': end}), encoding='utf-8')
        print('Enquiry intake baseline initialised; subsequent runs capture new inbox messages. No historical import performed.')
        return
    else:
        since = (now - dt.timedelta(days=1)).isoformat().replace('+00:00', 'Z')
    connector = Path(__file__).with_name('enquiry_connector.ps1')
    sourcefile = args.state_dir / 'inbox-latest.json'
    powershell(connector, ['-Action', 'Collect', '-Since', since, '-Until', end, '-OutputFile', str(sourcefile)])
    source = json.loads(sourcefile.read_text(encoding='utf-8-sig'))
    if source.get('has_more'): raise RuntimeError('More than 100 inbox messages in this window; checkpoint not advanced. Narrow the window for a controlled backfill.')
    candidates = [x for message in source['messages'] if (x := extract_candidate(message, source['mailbox']))]
    candidatefile = args.state_dir / 'candidates.json'; candidatefile.write_text(json.dumps(candidates, ensure_ascii=False), encoding='utf-8')
    if not args.ingest:
        print(json.dumps({'mode': 'read_only_preview', 'mailbox': source['mailbox'], 'messages_checked': len(source['messages']), 'potential_new_enquiries': len(candidates), 'candidate_file': str(candidatefile), 'mail_or_crm_changed': False}))
        return
    resultfile = args.state_dir / 'crm-receipts.json'
    if candidates:
        powershell(connector, ['-Action', 'Ingest', '-InputFile', str(candidatefile), '-OutputFile', str(resultfile)])
        saved = json.loads(resultfile.read_text(encoding='utf-8-sig'))
        for item in saved:
            if item['created']: print('New enquiry saved for review: ' + item['reference'] + ' — ' + item['client_name'])
    checkpoint.write_text(json.dumps({'until': end}), encoding='utf-8')

if __name__ == '__main__':
    try: main()
    except Exception as exc:
        raise SystemExit('Enquiry intake stopped; no blind retry or sign-in prompt: ' + str(exc))
