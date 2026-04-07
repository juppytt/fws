# gws API Support Status

fws currently mocks **56 REST endpoints + 5 helpers** across 3 of 17 gws services.

All supported endpoints are validated through actual `gws` CLI commands in `test/gws-validation.test.ts` (71 tests).

## Summary

| Service | Status | Implemented | Total | Notes |
|---------|--------|-------------|-------|-------|
| Gmail | Partial | 28 + 5 helpers | 79 | Messages (incl. batch/import), labels, threads (CRUD), profile, drafts, history, settings, +triage/+send/+reply/+forward |
| Calendar | Partial | 21 | 37 | Calendars (CRUD+clear), calendarList (CRUD), events (CRUD+import/move/quickAdd) |
| Drive | Partial | 18 | 57 | Files (CRUD+copy+emptyTrash), permissions (CRUD), drives (list/create), about |
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

## Gmail (28/79 + 5 helpers)

### Helpers

| gws command | Status | Notes |
|-------------|--------|-------|
| `gmail +triage` | ✅ gws-tested | Requires MITM proxy (HTTPS_PROXY + SSL_CERT_FILE) |
| `gmail +send` | ✅ gws-tested | Via MITM proxy |
| `gmail +reply` | ✅ gws-tested | Via MITM proxy |
| `gmail +reply-all` | ✅ gws-tested | Via MITM proxy |
| `gmail +forward` | ✅ gws-tested | Via MITM proxy |
| `gmail +watch` | — | Requires Pub/Sub (not mockable) |

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
| `gmail users messages import` | gmail.users.messages.import | ✅ gws-tested |
| `gmail users messages batchDelete` | gmail.users.messages.batchDelete | ✅ gws-tested |
| `gmail users messages batchModify` | gmail.users.messages.batchModify | ✅ gws-tested |

### Labels

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users labels list` | gmail.users.labels.list | ✅ gws-tested |
| `gmail users labels get` | gmail.users.labels.get | ✅ gws-tested |
| `gmail users labels create` | gmail.users.labels.create | ✅ gws-tested |
| `gmail users labels patch` | gmail.users.labels.patch | ✅ gws-tested |
| `gmail users labels delete` | gmail.users.labels.delete | ✅ gws-tested |
| `gmail users labels update` | gmail.users.labels.update | ✅ gws-tested |

### Threads

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users threads list` | gmail.users.threads.list | ✅ gws-tested |
| `gmail users threads get` | gmail.users.threads.get | ✅ gws-tested |
| `gmail users threads delete` | gmail.users.threads.delete | ✅ gws-tested |
| `gmail users threads trash` | gmail.users.threads.trash | ✅ gws-tested |
| `gmail users threads untrash` | gmail.users.threads.untrash | ✅ gws-tested |
| `gmail users threads modify` | gmail.users.threads.modify | ✅ gws-tested |

### Profile

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users getProfile` | gmail.users.getProfile | ✅ gws-tested |
| `gmail users watch` | gmail.users.watch | — |
| `gmail users stop` | gmail.users.stop | — |

### Settings

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users settings sendAs list` | gmail.users.settings.sendAs.list | ✅ gws-tested |
| `gmail users settings sendAs get` | gmail.users.settings.sendAs.get | ✅ gws-tested |
| Other settings endpoints | | — (26 endpoints) |

### Drafts

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users drafts list` | gmail.users.drafts.list | ✅ gws-tested |
| `gmail users drafts get` | gmail.users.drafts.get | ✅ gws-tested |
| `gmail users drafts create` | gmail.users.drafts.create | ✅ gws-tested |
| `gmail users drafts update` | gmail.users.drafts.update | ✅ gws-tested |
| `gmail users drafts delete` | gmail.users.drafts.delete | ✅ gws-tested |
| `gmail users drafts send` | gmail.users.drafts.send | ✅ gws-tested |

### History

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users history list` | gmail.users.history.list | ✅ gws-tested |

### Attachments

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users messages attachments get` | gmail.users.messages.attachments.get | ✅ gws-tested |

---

## Calendar (21/37)

### Calendar List

| gws command | API method | Status |
|-------------|-----------|--------|
| `calendar calendarList list` | calendar.calendarList.list | ✅ gws-tested |
| `calendar calendarList get` | calendar.calendarList.get | ✅ gws-tested |
| `calendar calendarList insert` | calendar.calendarList.insert | ✅ gws-tested |
| `calendar calendarList patch` | calendar.calendarList.patch | ✅ gws-tested |
| `calendar calendarList update` | calendar.calendarList.update | ✅ gws-tested |
| `calendar calendarList delete` | calendar.calendarList.delete | ✅ gws-tested |
| `calendar calendarList watch` | calendar.calendarList.watch | — |

### Calendars

| gws command | API method | Status |
|-------------|-----------|--------|
| `calendar calendars insert` | calendar.calendars.insert | ✅ gws-tested |
| `calendar calendars get` | calendar.calendars.get | ✅ gws-tested |
| `calendar calendars patch` | calendar.calendars.patch | ✅ gws-tested |
| `calendar calendars delete` | calendar.calendars.delete | ✅ gws-tested |
| `calendar calendars update` | calendar.calendars.update | ✅ gws-tested |
| `calendar calendars clear` | calendar.calendars.clear | ✅ gws-tested |

### Events

| gws command | API method | Status |
|-------------|-----------|--------|
| `calendar events list` | calendar.events.list | ✅ gws-tested |
| `calendar events get` | calendar.events.get | ✅ gws-tested |
| `calendar events insert` | calendar.events.insert | ✅ gws-tested |
| `calendar events patch` | calendar.events.patch | ✅ gws-tested |
| `calendar events update` | calendar.events.update | ✅ gws-tested |
| `calendar events delete` | calendar.events.delete | ✅ gws-tested |
| `calendar events import` | calendar.events.import | ✅ gws-tested |
| `calendar events instances` | calendar.events.instances | — |
| `calendar events move` | calendar.events.move | ✅ gws-tested |
| `calendar events quickAdd` | calendar.events.quickAdd | ✅ gws-tested |
| `calendar events watch` | calendar.events.watch | — |

### Other (all unsupported)

ACL (7 endpoints), channels, colors, freebusy, settings — not implemented.

---

## Drive (18/57)

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
| `drive files emptyTrash` | drive.files.emptyTrash | ✅ gws-tested |
| `drive files watch` | drive.files.watch | — |
| `drive files modifyLabels` | drive.files.modifyLabels | — |
| `drive files listLabels` | drive.files.listLabels | — |

### Permissions

| gws command | API method | Status |
|-------------|-----------|--------|
| `drive permissions list` | drive.permissions.list | ✅ gws-tested |
| `drive permissions get` | drive.permissions.get | ✅ gws-tested |
| `drive permissions create` | drive.permissions.create | ✅ gws-tested |
| `drive permissions update` | drive.permissions.update | ✅ gws-tested |
| `drive permissions delete` | drive.permissions.delete | ✅ gws-tested |

### Drives (Shared Drives)

| gws command | API method | Status |
|-------------|-----------|--------|
| `drive drives list` | drive.drives.list | ✅ gws-tested |
| `drive drives create` | drive.drives.create | ✅ gws-tested |
| `drive drives get` | drive.drives.get | ✅ gws-tested |
| `drive drives update` | drive.drives.update | ✅ gws-tested |
| `drive drives delete` | drive.drives.delete | ✅ gws-tested |
| `drive drives hide` | drive.drives.hide | — |
| `drive drives unhide` | drive.drives.unhide | — |

### Other (all unsupported)

Comments (5), replies (5), revisions (4), changes (3), channels, apps, teamdrives, approvals, accessproposals, operations — not implemented.

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
