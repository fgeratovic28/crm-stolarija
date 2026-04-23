-- Demo podaci za CRM Stolarija
-- Ovaj skript će popuniti bazu podataka sa realističnim podacima za prezentaciju.

-- Prvo brišemo postojeće podatke da izbegnemo konflikte
-- Redosled je bitan zbog stranih ključeva!
TRUNCATE TABLE field_reports CASCADE;
TRUNCATE TABLE work_orders CASCADE;
TRUNCATE TABLE material_orders CASCADE;
TRUNCATE TABLE payments CASCADE;
TRUNCATE TABLE activities CASCADE;
TRUNCATE TABLE files CASCADE;
TRUNCATE TABLE jobs CASCADE;
TRUNCATE TABLE customers CASCADE;
TRUNCATE TABLE suppliers CASCADE;
TRUNCATE TABLE teams CASCADE;

-- 1. TIMOVI (Teams)
INSERT INTO teams (id, name, contact_phone) VALUES
('00000000-0000-0000-0000-000000000001', 'Tim Alfa - Montaža', '+381 61 111 2222'),
('00000000-0000-0000-0000-000000000002', 'Tim Beta - Servis', '+381 61 333 4444'),
('00000000-0000-0000-0000-000000000003', 'Proizvodnja Pogon 1', '+381 61 555 6666');

-- 2. DOBAVLJAČI (Suppliers)
INSERT INTO suppliers (id, name, contact_person, phone, email, address, material_types) VALUES
('d0000000-0000-0000-0000-000000000001', 'GlassPro d.o.o.', 'Petar Perić', '+381 11 444 5555', 'prodaja@glasspro.rs', 'Batajnički drum 10, Zemun', '{glass}'),
('d0000000-0000-0000-0000-000000000002', 'Rehau Srbija', 'Marko Marković', '+381 11 666 7777', 'info@rehau.rs', 'Bulevar Milutina Milankovića 11, Novi Beograd', '{profile}'),
('d0000000-0000-0000-0000-000000000003', 'AutoDoor Systems', 'Luka Lukić', '+381 21 888 9999', 'office@autodoor.rs', 'Temerinski put bb, Novi Sad', '{hardware}'),
('d0000000-0000-0000-0000-000000000004', 'RolTek d.o.o.', 'Jovan Jovanović', '+381 18 222 3333', 'kontakt@roltek.rs', 'Industrijska zona sever, Niš', '{shutters, mosquito_net}');

-- 3. KLIJENTI (Customers)
INSERT INTO customers (id, customer_number, name, billing_address, installation_address, phones, emails, pib, registration_number, contact_person) VALUES
('c0000000-0000-0000-0000-000000000001', 'KU-001', 'Marko Petrović', 'Knez Mihailova 22, Beograd 11000', 'Bulevar Oslobođenja 115, Novi Sad 21000', ARRAY['+381 64 123 4567', '+381 11 234 5678'], ARRAY['marko@example.com'], '123456789', '98765432', 'Marko Petrović'),
('c0000000-0000-0000-0000-000000000002', 'KU-002', 'Ana Jovanović d.o.o.', 'Terazije 8, Beograd 11000', 'Terazije 8, Beograd 11000', ARRAY['+381 63 987 6543'], ARRAY['ana@jovanovicco.rs', 'office@jovanovicco.rs'], '987654321', '12345678', 'Ana Jovanović'),
('c0000000-0000-0000-0000-000000000003', 'KU-003', 'Dragan Nikolić', 'Svetozara Markovića 4, Niš 18000', 'Svetozara Markovića 4, Niš 18000', ARRAY['+381 65 111 2222'], ARRAY['dragan.n@example.com'], '111222333', '33322211', 'Dragan Nikolić'),
('c0000000-0000-0000-0000-000000000004', 'KU-004', 'Hotel Grand Vojvodina', 'Trg Slobode 2, Novi Sad 21000', 'Trg Slobode 2, Novi Sad 21000', ARRAY['+381 21 555 6666', '+381 64 777 8888'], ARRAY['milan@grandhotel.rs'], '444555666', '66655544', 'Milan Savić'),
('c0000000-0000-0000-0000-000000000005', 'KU-005', 'Jelena Đorđević', 'Kralja Petra I 33, Kragujevac 34000', 'Stari Grad bb, Kragujevac 34000', ARRAY['+381 66 333 4444'], ARRAY['jelena.dj@example.com'], '777888999', '99988877', 'Jelena Đorđević');

-- 4. POSLOVI (Jobs)
INSERT INTO jobs (id, customer_id, job_number, status, summary, total_price, vat_amount, advance_payment, scheduled_date, created_at) VALUES
('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'POS-2025-001', 'in_production', 'Kompletna zamena prozora – 12 PVC prozora sa trostrukim staklom, uključujući demontažu starih okvira', 485000, 97000, 145500, '2025-04-10 09:00:00+00', '2025-01-15'),
('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'POS-2025-002', 'waiting_material', 'Staklena pregradna vrata za kancelariju – 4 klizna staklena vrata sa aluminijumskim okvirima', 320000, 64000, 96000, '2025-04-18 10:00:00+00', '2025-02-01'),
('a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'POS-2025-003', 'accepted', 'Zatvaranje balkona PVC profilima i komarnicima', 175000, 35000, 0, NULL, '2025-03-10'),
('a0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'POS-2025-004', 'scheduled', 'Ulaz u hotelski lobi – automatska klizna vrata sa sigurnosnim staklom', 890000, 178000, 445000, '2025-04-22 08:30:00+00', '2025-02-15'),
('a0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'POS-2025-005', 'complaint', 'Zamena kuhinjskog prozora – prijavljeno propuštanje nakon ugradnje', 65000, 13000, 65000, NULL, '2025-01-20'),
('a0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000001', 'POS-2025-006', 'completed', 'Unutrašnja drvena vrata – 5 punih hrastovih vrata sa okvirima', 250000, 50000, 250000, '2025-01-10 10:00:00+00', '2024-11-20'),
('a0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000004', 'POS-2025-007', 'measurement_processing', 'Roletne za hotelske sobe – 45 roletni sa elektromotorom', 1250000, 250000, 375000, '2025-05-15 08:00:00+00', '2025-03-01');

-- 5. AKTIVNOSTI (Activities)
INSERT INTO activities (id, job_id, type, description, date) VALUES
(gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', 'phone', 'Početni upit o zameni prozora. Kupac želi trostruko staklo za zvučnu izolaciju.', '2025-01-15 09:30:00'),
(gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', 'in_person', 'Terenska poseta za merenje. Potvrđeno 12 prozora, zabeležene varijacije u debljini zida.', '2025-01-18 10:00:00'),
(gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', 'email', 'Poslata zvanična ponuda sa specificiranim cenama. Čeka se potvrda.', '2025-01-20 14:00:00'),
(gen_random_uuid(), 'a0000000-0000-0000-0000-000000000002', 'email', 'Menadžer kancelarije zatražio ponudu za staklena pregradna vrata.', '2025-02-01 08:00:00'),
(gen_random_uuid(), 'a0000000-0000-0000-0000-000000000005', 'phone', 'Kupac prijavio promaju iz novopostavljenog kuhinjskog prozora. Zakazana inspekcija.', '2025-03-15 09:00:00');

-- 6. UPLATE (Payments)
INSERT INTO payments (job_id, amount, date, note) VALUES
('a0000000-0000-0000-0000-000000000001', 145500, '2025-01-26', 'Avans - 30%'),
('a0000000-0000-0000-0000-000000000002', 96000, '2025-02-05', 'Avans - 30%'),
('a0000000-0000-0000-0000-000000000004', 445000, '2025-02-20', 'Avans - 50%'),
('a0000000-0000-0000-0000-000000000005', 65000, '2025-01-25', 'Celokupna uplata unapred'),
('a0000000-0000-0000-0000-000000000006', 125000, '2024-11-25', 'Prva rata'),
('a0000000-0000-0000-0000-000000000006', 125000, '2024-12-20', 'Završna uplata'),
('a0000000-0000-0000-0000-000000000007', 375000, '2025-03-05', 'Avans - 30%');

-- 7. NARUDŽBENICE MATERIJALA (Material Orders)
INSERT INTO material_orders (job_id, material_type, supplier_id, supplier_price, delivery_status, paid, notes, expected_delivery_date) VALUES
('a0000000-0000-0000-0000-000000000001', 'glass', 'd0000000-0000-0000-0000-000000000001', 180000, 'delivered', TRUE, 'Trostruko staklo 4-16-4-16-4, low-e premaz', '2025-03-15'),
('a0000000-0000-0000-0000-000000000001', 'profile', 'd0000000-0000-0000-0000-000000000002', 95000, 'delivered', TRUE, 'Rehau Brillant 70mm, bela boja', '2025-03-10'),
('a0000000-0000-0000-0000-000000000002', 'glass', 'd0000000-0000-0000-0000-000000000001', 120000, 'shipped', FALSE, '10mm kaljeno sigurnosno staklo, prozirno', '2025-04-05'),
('a0000000-0000-0000-0000-000000000004', 'hardware', 'd0000000-0000-0000-0000-000000000003', 350000, 'pending', TRUE, 'Automatski sistem kliznih vrata sa senzorima pokreta', '2025-04-15'),
('a0000000-0000-0000-0000-000000000007', 'shutters', 'd0000000-0000-0000-0000-000000000004', 450000, 'pending', FALSE, '45x električne roletne, RAL 7016 antracit', '2025-05-01');

-- 8. RADNI NALOZI (Work Orders)
INSERT INTO work_orders (id, job_id, type, description, team_id, date, status) VALUES
('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'measurement', 'Početno merenje svih 12 prozorskih otvora na terenu', '00000000-0000-0000-0000-000000000001', '2025-01-18', 'completed'),
('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'measurement_verification', 'Provera mera nakon isporuke profila', '00000000-0000-0000-0000-000000000001', '2025-03-20', 'completed'),
('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'production', 'Proizvodnja 12 PVC prozorskih jedinica', '00000000-0000-0000-0000-000000000003', '2025-03-25', 'in_progress'),
('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'installation', 'Demontaža starih prozora i ugradnja novih PVC jedinica', '00000000-0000-0000-0000-000000000001', '2025-04-10', 'pending'),
('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'measurement', 'Merenje otvora za kancelarijske pregrade', '00000000-0000-0000-0000-000000000002', '2025-02-05', 'completed'),
('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000005', 'complaint', 'Inspekcija prijavljenog problema sa promajom na kuhinjskom prozoru', '00000000-0000-0000-0000-000000000002', '2025-03-18', 'in_progress');

-- 9. TERENSKI IZVEŠTAJI (Field Reports)
INSERT INTO field_reports (id, work_order_id, arrived, completed, everything_ok, measurements, general_report, arrival_datetime) VALUES
(gen_random_uuid(), 'b0000000-0000-0000-0000-000000000001', TRUE, TRUE, TRUE, 'P1: 120x140, P2: 120x140, P3: 80x120, P4-P12: 100x130', 'Svi prozori dostupni. Debljina zida 40cm. Treći sprat zahteva iznajmljivanje skele.', '2025-01-18 09:15:00'),
(gen_random_uuid(), 'b0000000-0000-0000-0000-000000000006', TRUE, FALSE, FALSE, 'Razmak: 3-5mm sa leve strane, 2mm na vrhu', 'Kupac prisutan. Problem verovatno nastao usled sleganja. Potrebno ponovno punjenje penom i podešavanje okova.', '2025-03-18 10:00:00');

-- 10. FAJLOVI (Files)
INSERT INTO files (id, job_id, category, filename, size) VALUES
('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'offers', 'Ponuda_KU001_v1.pdf', '245 KB'),
('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'finance', 'Faktura_Avans_001.pdf', '180 KB'),
('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'field_photos', 'foto_merenje_1.jpg', '3.4 MB'),
('f0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'supplier', 'AutoDoor_Specifikacija.pdf', '1.5 MB');
