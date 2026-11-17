-- a-dish-can-show-its-photo (#84): the dish-photos gate, off. The bucket, the
-- table and the functions follow in their own migrations once the owner has
-- approved the editor and cropper from the demo (tasks 2.6, 3.x).
-- change-gate: dish-photos
--
-- Only the gate's row: nothing a published build reads changes.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('dish-photos', 'DP', 'change', 'Dish photos',
   'Managers add, change and remove a dish''s photo in Menu, and the customer menu shows each photographed dish''s photo and opens it large when tapped.',
   'Menu has no photo field and the customer menu shows no photos, as today.',
   'a-dish-can-show-its-photo', 84);
