ALTER TABLE campus_private_results DROP CONSTRAINT IF EXISTS campus_private_results_operation_check;
ALTER TABLE campus_private_results ADD CONSTRAINT campus_private_results_operation_check
  CHECK (operation IN ('schedule','absence','announcements','grades','leave_notes','leave_apply','send_mail'));
