# Alpha.8 superseded

Alpha.8 не использовать как QA replacement. Основные причины: lifecycle finalization на неавторитетных сигналах, mutable delayed final, non-causal queue и недостаточная recovery/error isolation. Alpha.9 заменяет эти механизмы.
