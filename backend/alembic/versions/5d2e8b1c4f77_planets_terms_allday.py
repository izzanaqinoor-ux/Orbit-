"""planets, school terms, all-day due dates, job pay options, user birth date

Revision ID: 5d2e8b1c4f77
Revises: 3c1f7a9d2b64
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "5d2e8b1c4f77"
down_revision = "3c1f7a9d2b64"
branch_labels = None
depends_on = None
UUID = postgresql.UUID(as_uuid=False)

DEFAULTS = [("Study", "study", "study"), ("Work", "work", "work"), ("Personal", "personal", "personal"), ("Other", "other", "other")]


def upgrade() -> None:
    op.create_table(
        "planets",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False, server_default="other"),
        sa.Column("color", sa.Text(), nullable=False, server_default="other"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_planets_user", ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "id", name="uq_planets_user_id"),
        sa.UniqueConstraint("user_id", "name", name="uq_planet_name"),
        sa.CheckConstraint("kind IN ('study','work','personal','other')", name="chk_planet_kind"),
        sa.CheckConstraint("length(trim(name)) > 0", name="chk_planet_name"),
    )
    op.create_table(
        "school_terms",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_terms_user", ondelete="CASCADE"),
        sa.CheckConstraint("kind IN ('term','break')", name="chk_term_kind"),
        sa.CheckConstraint("end_date >= start_date", name="chk_term_span"),
    )
    op.create_index("ix_school_terms_user_start", "school_terms", ["user_id", "start_date"])

    op.add_column("commitments", sa.Column("due_all_day", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("commitments", sa.Column("planet_id", UUID, nullable=True))
    op.create_check_constraint("chk_all_day_needs_due", "commitments", "due_all_day = false OR due_at IS NOT NULL")
    # Column-specific SET NULL (PG15+): nulling the whole composite would try to null user_id.
    op.execute(
        "ALTER TABLE commitments ADD CONSTRAINT fk_planet_same_user FOREIGN KEY (user_id, planet_id) "
        "REFERENCES planets (user_id, id) ON DELETE SET NULL (planet_id)"
    )

    op.add_column("jobs", sa.Column("pay_basis", sa.Text(), nullable=False, server_default="hourly"))
    op.add_column("jobs", sa.Column("monthly_pay", sa.Numeric(10, 2), nullable=True))
    op.add_column("jobs", sa.Column("unpaid_break_minutes", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("jobs", sa.Column("break_after_minutes", sa.Integer(), nullable=False, server_default="480"))
    op.create_check_constraint("chk_job_pay_basis", "jobs", "pay_basis IN ('hourly', 'monthly')")
    op.create_check_constraint("chk_job_monthly_nonneg", "jobs", "monthly_pay IS NULL OR monthly_pay >= 0")
    op.create_check_constraint("chk_job_break_nonneg", "jobs", "unpaid_break_minutes >= 0 AND break_after_minutes >= 0")

    op.add_column("users", sa.Column("birth_date", sa.Date(), nullable=True))

    # Backfill: every existing user gets the four default planets; commitments are pointed at their kind's planet.
    for name, kind, color in DEFAULTS:
        op.execute(
            "INSERT INTO planets (id, user_id, name, kind, color) "
            f"SELECT gen_random_uuid(), id, '{name}', '{kind}', '{color}' FROM users"
        )
    op.execute(
        "UPDATE commitments c SET planet_id = p.id FROM planets p "
        "WHERE p.user_id = c.user_id AND p.kind = c.category::text AND p.name = initcap(c.category::text)"
    )


def downgrade() -> None:
    op.drop_column("users", "birth_date")
    for c in ("chk_job_break_nonneg", "chk_job_monthly_nonneg", "chk_job_pay_basis"):
        op.drop_constraint(c, "jobs")
    for col in ("break_after_minutes", "unpaid_break_minutes", "monthly_pay", "pay_basis"):
        op.drop_column("jobs", col)
    op.drop_constraint("fk_planet_same_user", "commitments")
    op.drop_constraint("chk_all_day_needs_due", "commitments")
    op.drop_column("commitments", "planet_id")
    op.drop_column("commitments", "due_all_day")
    op.drop_index("ix_school_terms_user_start", "school_terms")
    op.drop_table("school_terms")
    op.drop_table("planets")
