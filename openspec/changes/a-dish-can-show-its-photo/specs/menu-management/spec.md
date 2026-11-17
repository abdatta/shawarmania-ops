## ADDED Requirements

### Requirement: A manager gives a dish a photo from the dish's own editor

While the `dish-photos` gate is on, an authorised manager SHALL add, change and
remove a dish's photo in that dish's editor, entirely through the application.
The phone SHALL prepare the photo before it is sent: oriented upright,
centre-cropped to 4:3, a large image of at most 1200×900 and a 360×360 square
thumbnail taken from its centre, each WebP where the browser can encode it and
JPEG otherwise, and none larger than 1 MB. The editor SHALL preview the 4:3
image the customer will see, with the thumbnail's square marked inside it.

The photo SHALL be saved with the dish, on **Save**, after the dish's other
fields, and a failed photo upload SHALL NOT undo those fields: the editor SHALL
say the photo was not saved and offer to retry. **Remove** SHALL take the photo
off on Save; **Cancel** SHALL discard a photo picked but not saved. Menu's item
rows SHALL show a small thumbnail beside a dish that has a photo and nothing
beside one that does not.

A dish's photo SHALL be stored apart from the dish row itself, so that adding,
changing or removing a photo does not change the menu the counter reads or
cause any counter to re-read it.

With the gate off, the editor and the item rows SHALL be as they were before
this change, and the database SHALL refuse to set or clear a photo.

#### Scenario: A manager adds a photo
- **WHEN** a manager picks a portrait camera photo for a dish and saves
- **THEN** the dish's photo is the upright 4:3 crop they previewed, its row shows the thumbnail, and the customer menu shows it within the cache minute

#### Scenario: The upload fails
- **WHEN** a manager edits a dish's price and adds a photo, and the photo upload fails
- **THEN** the new price is saved, and the editor says the photo was not saved and offers Retry

#### Scenario: The counter is not disturbed
- **WHEN** a photo is added, changed or removed
- **THEN** no counter tablet re-reads its menu because of it, and the counter's menu is unchanged

#### Scenario: A biller
- **WHEN** a biller's session calls the function that sets a dish's photo, or writes to the photo bucket
- **THEN** it is refused

#### Scenario: The gate is off
- **WHEN** `dish-photos` is off
- **THEN** the dish editor has no Photo field, the item rows show no thumbnails, and a hand-crafted call to set or clear a photo is refused

### Requirement: A dish's photo belongs to its outlet, in the database and in storage

A dish's photo row SHALL belong to the dish's own outlet, and the database SHALL
refuse a row naming any other. Photo files SHALL be stored under their outlet's
folder in a private bucket, and storage policies SHALL let only the owner, and a
manager at that outlet, read, write or delete them; a path not shaped as an
outlet folder SHALL be reachable by nobody. Setting a photo SHALL be refused
unless both of its files already exist under the dish's outlet.

#### Scenario: Another outlet's manager
- **WHEN** a manager of one outlet, by hand-crafted request, sets a photo on another outlet's dish, reads that outlet's photo rows, or uploads, reads or deletes a file under that outlet's folder
- **THEN** each is refused by the database

#### Scenario: A key with no files
- **WHEN** a request sets a dish's photo to a key whose files were never uploaded, or were uploaded under another outlet
- **THEN** it is refused
