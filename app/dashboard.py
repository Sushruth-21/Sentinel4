import time
from typing import Dict
from rich.console import Console
from rich.table import Table
from config import MACHINES, SENSORS
from .alert_store import AlertStore

console = Console()

def render_dashboard(latest_values: Dict[str, Dict[str, float]], latest_risks: Dict[str, float], alert_store: AlertStore):
    table = Table(title="Sentinel 4 – Machine Health")
    table.add_column("Machine")
    for sensor in SENSORS:
        table.add_column(sensor)
    table.add_column("Risk")
    table.add_column("Status")

    for m in MACHINES:
        values = latest_values.get(m, {})
        risk = latest_risks.get(m, 0.0)
        
        if risk >= 0.8:
            status = "[bold red]CRITICAL[/bold red]"
        elif risk >= 0.6:
            status = "[bold yellow]WARNING[/bold yellow]"
        else:
            status = "[green]OK[/green]"
            
        row = [m]
        for sensor in SENSORS:
            val = values.get(sensor, "-")
            row.append(f"{val:.2f}" if isinstance(val, (int, float)) else "-")
        
        row.append(f"{risk:.2f}")
        row.append(status)
        table.add_row(*row)

    console.clear()
    console.print(table)

    # Show last 3 alerts
    recent = alert_store.get_recent_history(limit=3)
    if recent:
        console.print("\n[bold]Recent Alerts:[/bold]")
        for a in recent:
            console.print(f"- {a.machine_id} | risk={a.risk:.2f} | {a.message}")
            if "explanation" in a.details:
                console.print(f"  [italic]{a.details['explanation']}[/italic]")
