-- Evidencija radnika i bolovanja.
-- Admin ima puni CRUD; ostale uloge nemaju pristup preko API-ja dok se eksplicitno ne otvore politike.

CREATE TABLE public.workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  position TEXT,
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.worker_sick_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  days_count INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT worker_sick_leaves_duration_check CHECK (
    (
      start_date IS NOT NULL
      AND end_date IS NOT NULL
      AND end_date >= start_date
    )
    OR (days_count IS NOT NULL AND days_count > 0)
  )
);

CREATE INDEX idx_workers_active ON public.workers(active);
CREATE INDEX idx_workers_team_id ON public.workers(team_id);
CREATE INDEX idx_workers_full_name ON public.workers(full_name);

CREATE INDEX idx_worker_sick_leaves_worker_id ON public.worker_sick_leaves(worker_id);
CREATE INDEX idx_worker_sick_leaves_start_date ON public.worker_sick_leaves(start_date);

ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_sick_leaves ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_workers ON public.workers
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY admin_all_worker_sick_leaves ON public.worker_sick_leaves
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'admin')
  WITH CHECK (public.get_current_user_role() = 'admin');
