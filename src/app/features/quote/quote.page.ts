import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonInput,
  IonTextarea, IonSpinner, IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  trashOutline, removeOutline, addOutline,
  checkmarkCircleOutline, ticketOutline, closeCircleOutline,
} from 'ionicons/icons';
import { QuoteService, QuoteSubmitClient } from '../../core/services/quote.service';

@Component({
  selector: 'app-quote',
  templateUrl: 'quote.page.html',
  styleUrls: ['quote.page.scss'],
  imports: [
    FormsModule,
    IonContent, IonHeader, IonToolbar, IonTitle,
    IonInput, IonTextarea, IonSpinner, IonIcon,
  ],
})
export class QuotePage {
  readonly qs     = inject(QuoteService);
  private readonly router = inject(Router);

  readonly couponCode  = signal('');
  readonly couponError = signal('');
  readonly couponOk    = signal(false);

  readonly submitting  = signal(false);
  readonly submitError = signal('');
  readonly submitted   = signal(false);
  readonly folio       = signal('');

  // Formulario cliente
  name    = '';
  email   = '';
  phone   = '';
  company = '';
  notes   = '';

  // Errores de validación
  readonly nameErr    = signal('');
  readonly emailErr   = signal('');

  constructor() {
    addIcons({
      trashOutline, removeOutline, addOutline,
      checkmarkCircleOutline, ticketOutline, closeCircleOutline,
    });
  }

  goToCatalog(): void {
    void this.router.navigate(['/catalog']);
  }

  applyCoupon(): void {
    const code = this.couponCode().trim();
    if (!code) return;
    this.couponError.set('');
    this.couponOk.set(false);
    this.qs.applyCoupon(code).subscribe({
      next: c => {
        this.couponOk.set(true);
        this.couponError.set('');
      },
      error: err => {
        const msg = err?.error?.error ?? err?.error?.message ?? 'Cupón no válido o expirado.';
        this.couponError.set(msg);
      },
    });
  }

  removeCoupon(): void {
    this.qs.removeCoupon();
    this.couponCode.set('');
    this.couponOk.set(false);
    this.couponError.set('');
  }

  removeItem(id: string): void {
    this.qs.remove(id);
  }

  changeQty(id: string, delta: number): void {
    const current = this.qs.qtyInCart(id);
    this.qs.updateQty(id, current + delta);
  }

  submit(): void {
    this.nameErr.set('');
    this.emailErr.set('');
    this.submitError.set('');

    let valid = true;
    if (!this.name.trim()) { this.nameErr.set('El nombre es requerido.'); valid = false; }
    if (!this.email.trim()) {
      this.emailErr.set('El correo es requerido.'); valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      this.emailErr.set('Ingresa un correo válido.'); valid = false;
    }
    if (!valid) return;

    const client: QuoteSubmitClient = {
      name:    this.name.trim(),
      email:   this.email.trim(),
      phone:   this.phone.trim() || undefined,
      company: this.company.trim() || undefined,
      notes:   this.notes.trim() || undefined,
    };

    this.submitting.set(true);
    this.qs.submitQuote(client).subscribe({
      next: result => {
        this.folio.set(result.folio ?? result.id);
        this.submitted.set(true);
        this.submitting.set(false);
      },
      error: err => {
        const msg = err?.error?.error ?? err?.error?.message ?? 'No fue posible enviar la cotización.';
        this.submitError.set(msg);
        this.submitting.set(false);
      },
    });
  }

  formatCLP(n: number): string {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
    }).format(n);
  }

  newQuote(): void {
    this.submitted.set(false);
    this.folio.set('');
    this.name = '';
    this.email = '';
    this.phone = '';
    this.company = '';
    this.notes = '';
  }
}
