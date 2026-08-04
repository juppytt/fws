# gws API Support Status

fws currently provides functional route implementations for **113 REST
methods + 5 helpers** across 6 of 17 gws services. Another 6 methods have
placeholder routes that return stub responses without implementing the
underlying behavior.

Entries marked ✅ are validated through actual `gws` CLI commands in
`test/gws-validation.test.ts`.
Regular discovery-backed methods and helpers both retain their Google API
hostname and path and transit the fws MITM proxy.

## Summary

| Service | Status | Implemented | Total | Notes |
|---------|--------|-------------|-------|-------|
| Gmail | Partial | 34 + 5 helpers | 79 | Messages (incl. batch/import), labels, threads (CRUD), profile, drafts, history, settings, +triage/+send/+reply/+forward |
| Calendar | Partial | 21 | 37 | Calendars (CRUD+clear), calendarList (CRUD), events (CRUD+import/move/quickAdd) |
| Drive | Partial | 18 | 64 | Files (CRUD+copy+emptyTrash), permissions (CRUD), drives (CRUD), about |
| Tasks | Full | 14 | 14 | Task lists CRUD, tasks CRUD/move/clear |
| Sheets | Partial | 7 + 3 stubs | 17 | Spreadsheets create/get, sheet copy, values get/update/append/clear; batchUpdate routes are stubs |
| People | Partial | 19 + 3 stubs | 24 | Contacts CRUD/search/batch, contact groups CRUD/batch, connections; Other Contacts routes are stubs |
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

**Status legend:** ✅ Supported + gws-tested · ⚠️ Implemented, but without a committed gws regression test · ◑ Stub response only · — Not implemented

---

## Gmail (34/79 + 5 helpers)

### Helpers

| gws command | Status | Notes |
|-------------|--------|-------|
| `gmail +triage` | ✅ gws-tested | Requires MITM proxy (HTTPS_PROXY + SSL_CERT_FILE) |
| `gmail +send` | ✅ gws-tested | Via MITM proxy |
| `gmail +reply` | ✅ gws-tested | Via MITM proxy |
| `gmail +reply-all` | ✅ gws-tested | Via MITM proxy |
| `gmail +forward` | ✅ gws-tested | Via MITM proxy |
| `gmail +watch` | — | Requires a Pub/Sub-compatible notification path |

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
| `gmail users settings sendAs get` | gmail.users.settings.sendAs.get | ⚠️ Implemented |
| Other settings endpoints | | — (43 endpoints) |

### Drafts

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users drafts list` | gmail.users.drafts.list | ✅ gws-tested |
| `gmail users drafts get` | gmail.users.drafts.get | ✅ gws-tested |
| `gmail users drafts create` | gmail.users.drafts.create | ✅ gws-tested |
| `gmail users drafts update` | gmail.users.drafts.update | ⚠️ Implemented |
| `gmail users drafts delete` | gmail.users.drafts.delete | ✅ gws-tested |
| `gmail users drafts send` | gmail.users.drafts.send | ⚠️ Implemented |

### History

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users history list` | gmail.users.history.list | ✅ gws-tested |

### Attachments

| gws command | API method | Status |
|-------------|-----------|--------|
| `gmail users messages attachments get` | gmail.users.messages.attachments.get | ⚠️ Implemented |

---

## Calendar (21/37)

### Calendar List

| gws command | API method | Status |
|-------------|-----------|--------|
| `calendar calendarList list` | calendar.calendarList.list | ✅ gws-tested |
| `calendar calendarList get` | calendar.calendarList.get | ✅ gws-tested |
| `calendar calendarList insert` | calendar.calendarList.insert | ✅ gws-tested |
| `calendar calendarList patch` | calendar.calendarList.patch | ✅ gws-tested |
| `calendar calendarList update` | calendar.calendarList.update | ⚠️ Implemented |
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

## Drive (18/64)

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
| `drive permissions update` | drive.permissions.update | ⚠️ Implemented |
| `drive permissions delete` | drive.permissions.delete | ⚠️ Implemented |

### Drives (Shared Drives)

| gws command | API method | Status |
|-------------|-----------|--------|
| `drive drives list` | drive.drives.list | ✅ gws-tested |
| `drive drives create` | drive.drives.create | ⚠️ Implemented |
| `drive drives get` | drive.drives.get | ⚠️ Implemented |
| `drive drives update` | drive.drives.update | ⚠️ Implemented |
| `drive drives delete` | drive.drives.delete | ⚠️ Implemented |
| `drive drives hide` | drive.drives.hide | — |
| `drive drives unhide` | drive.drives.unhide | — |

### Other (all unsupported)

Comments (5), replies (5), revisions (4), changes (3), channels, apps, teamdrives, approvals, accessproposals, operations — not implemented.

---

## Tasks (14/14) — fully implemented

The gws regression suite covers task-list and task
list/get/insert/patch/delete flows plus task clear. The PUT update methods and
task move are implemented but do not have committed gws regression tests.

## Sheets (7 functional + 3 stubs / 17)

| gws command | API method | Status |
|-------------|-----------|--------|
| `sheets spreadsheets create` | sheets.spreadsheets.create | ✅ gws-tested |
| `sheets spreadsheets get` | sheets.spreadsheets.get | ✅ gws-tested |
| `sheets spreadsheets batchUpdate` | sheets.spreadsheets.batchUpdate | ◑ Returns empty replies without applying requests |
| `sheets spreadsheets values get` | sheets.spreadsheets.values.get | ✅ gws-tested |
| `sheets spreadsheets values update` | sheets.spreadsheets.values.update | ✅ gws-tested |
| `sheets spreadsheets values append` | sheets.spreadsheets.values.append | ⚠️ Implemented |
| `sheets spreadsheets values clear` | sheets.spreadsheets.values.clear | ⚠️ Implemented |
| `sheets spreadsheets sheets copyTo` | sheets.spreadsheets.sheets.copyTo | ⚠️ Implemented |
| `sheets spreadsheets values batchUpdate` | sheets.spreadsheets.values.batchUpdate | ◑ Returns an empty response list without updating cells |
| `sheets spreadsheets values batchClear` | sheets.spreadsheets.values.batchClear | ◑ Returns an empty response list without clearing cells |
| `sheets spreadsheets values batchGet` | sheets.spreadsheets.values.batchGet | — Route currently returns 404 |
| Data-filter and developer-metadata methods | | — (6 endpoints) |

## People (19 functional + 3 stubs / 24)

| gws command | API method | Status |
|-------------|-----------|--------|
| `people people get` | people.people.get | ✅ gws-tested |
| `people people createContact` | people.people.createContact | ⚠️ Implemented |
| `people people updateContact` | people.people.updateContact | ⚠️ Implemented |
| `people people deleteContact` | people.people.deleteContact | ⚠️ Implemented |
| `people people searchContacts` | people.people.searchContacts | ⚠️ Implemented |
| `people people getBatchGet` | people.people.getBatchGet | ⚠️ Implemented |
| `people people batchCreateContacts` | people.people.batchCreateContacts | ⚠️ Implemented |
| `people people batchUpdateContacts` | people.people.batchUpdateContacts | ⚠️ Implemented |
| `people people batchDeleteContacts` | people.people.batchDeleteContacts | ⚠️ Implemented |
| `people people connections list` | people.people.connections.list | ✅ gws-tested |
| `people people listDirectoryPeople` | people.people.listDirectoryPeople | ⚠️ Implemented |
| `people people searchDirectoryPeople` | people.people.searchDirectoryPeople | ⚠️ Implemented |
| `people contactGroups list` | people.contactGroups.list | ✅ gws-tested |
| `people contactGroups get` | people.contactGroups.get | ✅ gws-tested |
| `people contactGroups create` | people.contactGroups.create | ⚠️ Implemented |
| `people contactGroups delete` | people.contactGroups.delete | ⚠️ Implemented |
| `people contactGroups update` | people.contactGroups.update | ⚠️ Implemented |
| `people contactGroups batchGet` | people.contactGroups.batchGet | ⚠️ Implemented |
| `people contactGroups members modify` | people.contactGroups.members.modify | ⚠️ Implemented |
| `people otherContacts list` | people.otherContacts.list | ◑ Always returns an empty collection |
| `people otherContacts search` | people.otherContacts.search | ◑ Always returns an empty result |
| `people otherContacts copyOtherContactToMyContactsGroup` | people.otherContacts.copyOtherContactToMyContactsGroup | ◑ Returns a placeholder person without storing it |
| `people people updateContactPhoto` | people.people.updateContactPhoto | — |
| `people people deleteContactPhoto` | people.people.deleteContactPhoto | — |

## Events (0/15) — not yet supported

Workspace event subscriptions, push notifications.

## Other services — not yet supported

Docs, Slides, Chat, Classroom, Forms, Keep, Meet, Admin Reports, Model Armor, Workflow — no discovery cache present, not yet implemented.
