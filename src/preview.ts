import type { Anatomy } from './analyze';
import { DT } from './creature';
import { COUNTDOWN, Race } from './race';

// A real one-creature race. Skip displaying the countdown, but simulate all
// its settling ticks: rolling contacts depend on the state before the gun.
export class RacePreview {
  race: Race;
  private acc = 0;

  constructor(private anatomy: Anatomy) {
    this.race = this.create();
  }

  private create() {
    const race = new Race([{ anatomy: this.anatomy, name: '', kind: 'player' }]);
    for (let i = 0; i < COUNTDOWN; i++) race.step();
    race.events.length = 0;
    return race;
  }

  advance(dt: number): boolean {
    this.acc += dt;
    let restarted = false;
    while (this.acc >= DT) {
      this.acc -= DT;
      if (this.race.over) { this.race = this.create(); restarted = true; }
      this.race.step();
    }
    this.race.events.length = 0;
    return restarted;
  }
}
