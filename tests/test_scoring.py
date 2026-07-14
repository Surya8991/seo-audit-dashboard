"""Tests for modules/scoring.py: category-score penalties, weighted total,
HTTP-status adjustments, and thematic grouping (incl. the Image SEO fix)."""

from modules.scoring import (
    PENALTY,
    THEMES,
    WEIGHTS,
    calculate_seo_score,
    get_thematic_issues,
    get_top_issues_by_impact,
)


def _issue(category="Metadata", severity="Warning", impact=5):
    return {"issue": f"{category} problem", "category": category, "severity": severity,
            "recommendation": "fix it", "impact_score": impact, "effort": "Low"}


def test_perfect_result_scores_100():
    result = {"status_code": 200}
    out = calculate_seo_score(result)
    assert out["score"] == 100.0
    assert all(v == 100.0 for v in out["breakdown"].values())


def test_empty_category_scores_100():
    from modules.scoring import _category_score
    assert _category_score([]) == 100.0


def test_penalty_severities_subtract_correctly():
    from modules.scoring import _category_score
    # One Critical (25) + one Warning (6) = 31 penalty -> 69.
    score = _category_score([_issue(severity="Critical"), _issue(severity="Warning")])
    assert score == 100.0 - PENALTY["Critical"] - PENALTY["Warning"]
    assert score == 69.0


def test_category_score_floors_at_zero():
    from modules.scoring import _category_score
    many_criticals = [_issue(severity="Critical") for _ in range(10)]  # 250 penalty
    assert _category_score(many_criticals) == 0.0


def test_fetch_error_zeroes_the_score():
    assert calculate_seo_score({"status_code": 0, "fetch_error": "boom"})["score"] == 0.0
    assert calculate_seo_score({"status_code": 0})["score"] == 0.0


def test_4xx_status_penalizes_50():
    # All categories perfect (100) but a 404 status subtracts 50.
    out = calculate_seo_score({"status_code": 404})
    assert out["score"] == 50.0


def test_3xx_status_penalizes_10():
    out = calculate_seo_score({"status_code": 301})
    assert out["score"] == 90.0


def test_weights_sum_to_one():
    # The weighted total only equals a clean 0-100 if the weights sum to 1.
    assert round(sum(WEIGHTS.values()), 6) == 1.0


def test_scoring_uses_image_detail_over_legacy_images():
    # A clean image_detail should keep images at 100 even if legacy images has issues.
    result = {
        "status_code": 200,
        "image_detail": {"issues": []},
        "images": {"issues": [_issue(category="Images", severity="Critical")]},
    }
    assert calculate_seo_score(result)["breakdown"]["images"] == 100.0


def test_image_seo_category_groups_under_images_theme():
    grouped = get_thematic_issues([_issue(category="Image SEO", severity="High")])
    assert "Images" in grouped
    assert len(grouped["Images"]) == 1
    assert "Other" not in grouped  # must NOT fall into the catch-all bucket


def test_themes_cover_expected_buckets():
    assert "Image SEO" in THEMES["Images"]


def test_top_issues_sorted_by_impact_descending():
    issues = [_issue(impact=3), _issue(impact=9), _issue(impact=6)]
    top = get_top_issues_by_impact(issues, top_n=2)
    assert [i["impact_score"] for i in top] == [9, 6]
