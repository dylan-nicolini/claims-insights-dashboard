import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';

import { routes } from './app/app.routes';
import { ShellComponent } from './app/shell/shell.component';

bootstrapApplication(ShellComponent, {
  providers: [
    provideRouter(routes),
    provideAnimations(),
    provideZonelessChangeDetection(),
    provideHttpClient(),
  ],
}).catch(err => console.error(err));
