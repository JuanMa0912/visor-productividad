-- Seed usuarios por sede (rol: user)
-- Clave temporal: 12345678
-- Hash generado con bcryptjs (cost 12)

INSERT INTO app_users (username, password_hash, role, sede, is_active)
VALUES
  ('sede_calle5ta', '$2a$12$Y53Qa2R4.mJ/fwrEdS0vt.uBXgW.F6mAEve1gCyEJKDC1NjsCmP/q', 'user', 'Calle 5ta', true),
  ('sede_la39', '$2a$12$Y53Qa2R4.mJ/fwrEdS0vt.uBXgW.F6mAEve1gCyEJKDC1NjsCmP/q', 'user', 'La 39', true),
  ('sede_plazanorte', '$2a$12$Y53Qa2R4.mJ/fwrEdS0vt.uBXgW.F6mAEve1gCyEJKDC1NjsCmP/q', 'user', 'Plaza Norte', true),
  ('sede_ciudadjardin', '$2a$12$Y53Qa2R4.mJ/fwrEdS0vt.uBXgW.F6mAEve1gCyEJKDC1NjsCmP/q', 'user', 'Ciudad Jardin', true),
  ('sede_centrosur', '$2a$12$Y53Qa2R4.mJ/fwrEdS0vt.uBXgW.F6mAEve1gCyEJKDC1NjsCmP/q', 'user', 'Centro Sur', true),
  ('sede_palmira', '$2a$12$Y53Qa2R4.mJ/fwrEdS0vt.uBXgW.F6mAEve1gCyEJKDC1NjsCmP/q', 'user', 'Palmira', true),
  ('sede_floresta', '$2a$12$Y53Qa2R4.mJ/fwrEdS0vt.uBXgW.F6mAEve1gCyEJKDC1NjsCmP/q', 'user', 'Floresta', true),
  ('sede_floralia', '$2a$12$Y53Qa2R4.mJ/fwrEdS0vt.uBXgW.F6mAEve1gCyEJKDC1NjsCmP/q', 'user', 'Floralia', true),
  ('sede_guaduales', '$2a$12$Y53Qa2R4.mJ/fwrEdS0vt.uBXgW.F6mAEve1gCyEJKDC1NjsCmP/q', 'user', 'Guaduales', true),
  ('sede_bogota', '$2a$12$Y53Qa2R4.mJ/fwrEdS0vt.uBXgW.F6mAEve1gCyEJKDC1NjsCmP/q', 'user', 'Bogota', true),
  ('sede_chia', '$2a$12$Y53Qa2R4.mJ/fwrEdS0vt.uBXgW.F6mAEve1gCyEJKDC1NjsCmP/q', 'user', 'Chia', true)
ON CONFLICT (username) DO NOTHING;
