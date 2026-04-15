"""Shared Pydantic recipe schema used by metadata_pass and other Python workers."""
from pydantic import BaseModel, Field


class Recipe(BaseModel):
    name: str = ""
    ingredients: list[str] = Field(default_factory=list)
    directions: list[str] = Field(default_factory=list)
    yield_: str | None = Field(default=None, alias="yield")
    prepTime: str | None = None
    cookTime: str | None = None
    image: str | None = None

    class Config:
        populate_by_name = True


def confidence_score(r: Recipe) -> float:
    s = 0.0
    if r.name and len(r.name) > 3:                          s += 0.30
    if r.ingredients and len(r.ingredients) >= 2:           s += 0.35
    if r.directions and len(r.directions) >= 1:             s += 0.25
    if r.yield_ or r.prepTime or r.cookTime:                s += 0.10
    return min(1.0, s)
