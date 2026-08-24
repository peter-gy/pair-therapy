import marimo

__generated_with = "0.24.0"
app = marimo.App(width="medium")


@app.cell
def _():
    fixture_label = "Pair Therapy"
    return (fixture_label,)


@app.cell
def _(fixture_label):
    f"{fixture_label} live-kernel fixture"
    return


if __name__ == "__main__":
    app.run()
