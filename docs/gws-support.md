# gws API Support Status

fws currently mocks **35 REST endpoints + 1 helper** across 3 of 17 gws services.

All supported endpoints are validated through actual `gws` CLI commands in `test/gws-validation.test.ts` (41 tests).

## Summary

| Service | Status | Implemented | Total | Notes |
|---------|--------|-------------|-------|-------|
| Gmail | Partial | 16 + 1 helper | 79 | Messages, labels, threads, profile, +triage |
| Calendar | Partial | 12 | 37 | Calendars, calendarList, events |
| Drive | Partial | 7 | 57 | Files, about |
| Sheets | Not yet | 0 | 17 | |
| Tasks | Not yet | 0 | 14 | |
| People | Not yet | 0 | 24 | |
| Events | Not yet | 0 | 15 | |
| Docs | Not yet | — | — | |
| Slides | Not yet | — | — | |
| Chat | Not yet | — | — | |
| Classroom | Not yet | — | — | |
| Forms | Not yet | — | — | |
| Keep | Not yet | — | — | |
| Meet | Not yet | — | — | |
| Admin Reports | Not yet | — | — | |
| Model Armor | Not yet | — | — | |
| Workflow | Not yet | — | — | |

**Status legend:** ✅ Supported + gws-tested · ⚠️ Supported (HTTP only, not gws-tested) · — Not implemented

---

## Gmail (16/79 + 1 helper)

### Helpers

| gws command | Status | Notes |
|-------------|--------|-------|
| `gmail +triage` | ✅ gws-tested | Requires MITM proxy (HTTPS_PROXY + SSL_CERT_FILE) |
| `gmail +send` | — | Hardcodes googleapis.com URL |
| `gmail +reply` | — | Hardcodes googleapis.com URL |
| `gmail +reply-all` | — | Hardcodes googleapis.com URL |
| `gmail +forward` | — | Hardcodes googleapis.com URL |
| `gmail +watch` | — | Hardcodes googleapis.com URL |

### Messages

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users messages list` | gmail.users.messages.list | ✅ gws-tested |
| `gmail users messages get` | gmail.users.messages.get | ✅ gws-tested |
| `gmail users messages insert` | gmail.users.messages.insert | ✅ gws-tested |
| `gmail users messages send` | gmail.users.messages.send | ✅ gws-tested |
| `gmail users messages delete` | gmail.users.messages.delete | ✅ gws-tested |
| `gmail users messages trash` | gmail.users.messages.trash | ✅ gws-tested |
| `gmail users messages untrash` | gmail.users.messages.untrash | ✅ gws-tested |
| `gmail users messages modify` | gmail.users.messages.modify | ✅ gws-tested |
| `gmail users messages import` | gmail.users.messages.import | — |
| `gmail users messages batchDelete` | gmail.users.messages.batchDelete | — |
| `gmail users messages batchModify` | gmail.users.messages.batchModify | — |

### Labels

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users labels list` | gmail.users.labels.list | ✅ gws-tested |
| `gmail users labels get` | gmail.users.labels.get | ✅ gws-tested |
| `gmail users labels create` | gmail.users.labels.create | ✅ gws-tested |
| `gmail users labels patch` | gmail.users.labels.patch | ✅ gws-tested |
| `gmail users labels delete` | gmail.users.labels.delete | ✅ gws-tested |
| `gmail users labels update` | gmail.users.labels.update | — |

### Threads

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users threads list` | gmail.users.threads.list | ✅ gws-tested |
| `gmail users threads get` | gmail.users.threads.get | ✅ gws-tested |
| `gmail users threads delete` | gmail.users.threads.delete | — |
| `gmail users threads trash` | gmail.users.threads.trash | — |
| `gmail users threads untrash` | gmail.users.threads.untrash | — |
| `gmail users threads modify` | gmail.users.threads.modify | — |

### Profile

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users getProfile` | gmail.users.getProfile | ✅ gws-tested |
| `gmail users watch` | gmail.users.watch | — |
| `gmail users stop` | gmail.users.stop | — |

### Drafts

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users drafts list` | gmail.users.drafts.list | — |
| `gmail users drafts get` | gmail.users.drafts.get | — |
| `gmail users drafts create` | gmail.users.drafts.create | — |
| `gmail users drafts update` | gmail.users.drafts.update | — |
| `gmail users drafts delete` | gmail.users.drafts.delete | — |
| `gmail users drafts send` | gmail.users.drafts.send | — |

### History

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users history list` | gmail.users.history.list | — |

### Attachments

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users messages attachments get` | gmail.users.messages.attachments.get | — |

### Settings (all unsupported)

Settings, sendAs, filters, forwarding addresses, delegates, CSE identities/keypairs — 32 endpoints, none implemented.

---

## Calendar (12/37)

### Calendar List

| gws command | API method | Status |
|-------------|-----------|--------|
| `calendar calendarList list` | calendar.calendarList.list | ✅ gws-tested |
| `calendar calendarList get` | calendar.calendarList.get | ✅ gws-tested |
| `calendar calendarList insert` | calendar.calendarList.insert | — |
| `calendar calendarList patch` | calendar.calendarList.patch | — |
| `calendar calendarList update` | calendar.calendarList.update | — |
| `calendar calendarList delete` | calendar.calendarList.delete | — |
| `calendar calendarList watch` | calendar.calendarList.watch | — |

### Calendars

| gws command | API method | Status |
|-------------|-----------|--------|
| `calendar calendars insert` | calendar.calendars.insert | ✅ gws-tested |
| `calendar calendars get` | calendar.calendars.get | ✅ gws-tested |
| `calendar calendars patch` | calendar.calendars.patch | ✅ gws-tested |
| `calendar calendars delete` | calendar.calendars.delete | ✅ gws-tested |
| `calendar calendars update` | calendar.calendars.update | — |
| `calendar calendars clear` | calendar.calendars.clear | — |

### Events

| gws command | API method | Status |
|-------------|-----------|--------|
| `calendar events list` | calendar.events.list | ✅ gws-tested |
| `calendar events get` | calendar.events.get | ✅ gws-tested |
| `calendar events insert` | calendar.events.insert | ✅ gws-tested |
| `calendar events patch` | calendar.events.patch | ✅ gws-tested |
| `calendar events update` | calendar.events.update | ✅ gws-tested |
| `calendar events delete` | calendar.events.delete | ✅ gws-tested |
| `calendar events import` | calendar.events.import | — |
| `calendar events instances` | calendar.events.instances | — |
| `calendar events move` | calendar.events.move | — |
| `calendar events quickAdd` | calendar.events.quickAdd | — |
| `calendar events watch` | calendar.events.watch | — |

### Other (all unsupported)

ACL (7 endpoints), channels, colors, freebusy, settings — not implemented.

---

## Drive (7/57)

### About

| gws command | API method | Status |
|-------------|-----------|--------|
| `drive about get` | drive.about.get | ✅ gws-tested |

### Files

| gws command | API method | Status |
|-------------|-----------|--------|
| `drive files list` | drive.files.list | ✅ gws-tested |
| `drive files get` | drive.files.get | ✅ gws-tested |
| `drive files create` | drive.files.create | ✅ gws-tested |
| `drive files update` | drive.files.update | ✅ gws-tested |
| `drive files delete` | drive.files.delete | ✅ gws-tested |
| `drive files copy` | drive.files.copy | ✅ gws-tested |
| `drive files export` | drive.files.export | — |
| `drive files generateIds` | drive.files.generateIds | — |
| `drive files download` | drive.files.download | — |
| `drive files emptyTrash` | drive.files.emptyTrash | — |
| `drive files watch` | drive.files.watch | — |
| `drive files modifyLabels` | drive.files.modifyLabels | — |
| `drive files listLabels` | drive.files.listLabels | — |

### Other (all unsupported)

Drives (8), permissions (5), comments (5), replies (5), revisions (4), changes (3), channels, apps, teamdrives, approvals, accessproposals, operations — not implemented.

---

## Sheets (0/17) — not yet supported

Spreadsheets CRUD, values read/write/append/clear, batch operations, developer metadata, sheet copying.

## Tasks (0/14) — not yet supported

Task lists CRUD, tasks CRUD/move/clear.

## People (0/24) — not yet supported

Contacts CRUD, contact groups, directory people, other contacts.

## Events (0/15) — not yet supported

Workspace event subscriptions, push notifications.

## Other services — not yet supported

Docs, Slides, Chat, Classroom, Forms, Keep, Meet, Admin Reports, Model Armor, Workflow — no discovery cache present, not yet implemented.
