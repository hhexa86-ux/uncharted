-- Create contact_requests table for solution-based contact requests
CREATE TABLE IF NOT EXISTS contact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  innovator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  solution_id UUID NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
  challenge_id UUID REFERENCES challenges(id) ON DELETE SET NULL,
  subject TEXT,
  message TEXT NOT NULL,
  meeting_link TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_contact_requests_innovator_id ON contact_requests(innovator_id);
CREATE INDEX IF NOT EXISTS idx_contact_requests_organization_id ON contact_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_requests_solution_id ON contact_requests(solution_id);
CREATE INDEX IF NOT EXISTS idx_contact_requests_status ON contact_requests(status);

-- Enable RLS
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Organizations can view their sent requests
CREATE POLICY "Organizations can view their sent contact requests"
  ON contact_requests FOR SELECT
  USING (organization_id = auth.uid());

-- Policy: Innovators can view their received requests
CREATE POLICY "Innovators can view their received contact requests"
  ON contact_requests FOR SELECT
  USING (innovator_id = auth.uid());

-- Policy: Organizations can create contact requests
CREATE POLICY "Organizations can create contact requests"
  ON contact_requests FOR INSERT
  WITH CHECK (organization_id = auth.uid());

-- Policy: Innovators can update status of received requests
CREATE POLICY "Innovators can update contact request status"
  ON contact_requests FOR UPDATE
  USING (innovator_id = auth.uid())
  WITH CHECK (innovator_id = auth.uid());

-- Policy: Organizations can update their sent requests (e.g., add meeting link)
CREATE POLICY "Organizations can update their sent contact requests"
  ON contact_requests FOR UPDATE
  USING (organization_id = auth.uid())
  WITH CHECK (organization_id = auth.uid());
